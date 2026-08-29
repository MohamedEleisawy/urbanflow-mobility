import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { PersonalDataExportDto } from './dto/personal-data-export.dto';
import { hashPassword } from '../common/crypto/password.util';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const passwordHash = hashPassword(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          // Écriture imbriquée : Prisma crée la ligne UserPreferences dans la
          // même requête, uniquement si "preferences" a été fourni.
          preferences: dto.preferences
            ? { create: dto.preferences }
            : undefined,
        },
        include: { preferences: true },
      });

      return this.toPublicUser(user);
    } catch (error) {
      // P2002 = violation de contrainte unique (ici : email déjà utilisé).
      // Sans ce garde-fou, Prisma renverrait une erreur brute et Nest
      // répondrait 500 au lieu d'un 409 explicite pour le client.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Un utilisateur avec l'email ${dto.email} existe déjà`,
        );
      }
      throw error;
    }
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { preferences: true },
    });

    if (!user) {
      throw new NotFoundException(`Utilisateur ${id} introuvable`);
    }

    return this.toPublicUser(user);
  }

  /**
   * Met à jour les préférences de l'usager AUTHENTIFIÉ (étape 5E-1).
   *
   * ⚠️ `userId` VIENT DU JETON, JAMAIS DU CLIENT. Le controller le prend dans
   * `@CurrentUser().sub`, c'est-à-dire dans un jeton signé et vérifié. Aucun
   * paramètre d'URL, aucun champ de corps ne peut le désigner : c'est ce qui
   * rend structurellement impossible de modifier les préférences d'autrui.
   *
   * ═══ POURQUOI UN UPSERT, ET NON UN UPDATE ═══
   *
   * La relation `User → UserPreferences` est FACULTATIVE dans le schéma
   * (`preferences UserPreferences?`) : un compte créé sans sous-objet
   * `preferences` n'a tout simplement aucune ligne. Un `update` lèverait
   * alors P2025 — « enregistrement introuvable » — pour un usager
   * parfaitement valide. L'`upsert` crée la ligne au premier enregistrement,
   * et la met à jour ensuite.
   *
   * ═══ POURQUOI `co2BudgetWeekly` PEUT REFUSER LA CRÉATION ═══
   *
   * C'est le SEUL champ du modèle sans valeur par défaut. Sur la branche
   * `create` de l'upsert, Prisma l'exige donc.
   *
   * Lui inventer un défaut aurait résolu le problème en une ligne — et
   * fabriqué un budget carbone que personne n'a choisi. C'est le même refus
   * qu'aux étapes 4D-1 (aucun facteur d'émission inventé pour ESCOOTER) et
   * 4F-1A (aucune date de fin inventée) : mieux vaut une erreur explicite
   * qu'un chiffre faux présenté comme celui de l'usager.
   *
   * Ce refus ne concerne QUE la première écriture. Ensuite, un PATCH peut ne
   * porter que `theme` : la ligne existe, et `co2BudgetWeekly` garde sa
   * valeur.
   */
  async updatePreferences(userId: string, dto: UpdateUserPreferencesDto) {
    // `dto` ne contient QUE des champs connus : le ValidationPipe global
    // (`whitelist` + `forbidNonWhitelisted`) a déjà rejeté le reste en 400.
    // On peut donc l'étaler sans filtrer.
    //
    // ⚠️ PIÈGE PRISMA DÉCOUVERT ICI, ET IL COÛTE UN 500 : un `upsert` VALIDE
    // SA BRANCHE `create` MÊME QUAND IL PRENDRA `update`. Écrire
    //
    //     upsert({ update: dto, create: { ...dto, co2BudgetWeekly: dto.co2BudgetWeekly! } })
    //
    // échoue donc avec « Argument `co2BudgetWeekly` is missing » dès qu'un
    // PATCH ne porte que `theme` — c'est-à-dire dans le cas le plus courant.
    // D'où la séparation ci-dessous, qui n'appelle l'upsert que lorsque sa
    // branche `create` est réellement valide.

    if (dto.co2BudgetWeekly !== undefined) {
      // Le budget est fourni : les deux branches sont valides. Un seul appel
      // atomique suffit, et deux requêtes concurrentes du même usager ne
      // peuvent pas se marcher dessus.
      //
      // `!== undefined` et non `if (dto.co2BudgetWeekly)` : ZÉRO EST UNE
      // VALEUR. Un objectif « zéro émission » est légitime, et un test de
      // vérité le confondrait avec l'absence.
      return this.prisma.userPreferences.upsert({
        where: { userId },
        update: dto,
        create: { ...dto, co2BudgetWeekly: dto.co2BudgetWeekly, userId },
      });
    }

    // Aucun budget fourni : seule une mise à jour est possible, puisque la
    // création l'exige.
    const existantes = await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!existantes) {
      throw new BadRequestException(
        'Un budget carbone hebdomadaire est nécessaire pour créer vos préférences.',
      );
    }

    // Un champ absent du corps N'EST PAS écrasé : Prisma ignore les clés
    // `undefined`. C'est bien la sémantique d'un PATCH — décrire ce qui
    // change, et rien d'autre.
    return this.prisma.userPreferences.update({
      where: { userId },
      data: dto,
    });
  }

  /**
   * Rassemble TOUTES les données personnelles d'un usager (étape 5F).
   *
   * Le dossier promet à l'usager de « télécharger à tout moment un fichier
   * contenant l'intégralité de ses informations personnelles ».
   *
   * ⚠️ `userId` VIENT DU JETON. Le controller le prend dans
   * `@CurrentUser().sub` ; aucune route, aucun corps, aucune query ne peut le
   * désigner. C'est ce qui rend structurellement impossible d'exporter le
   * compte d'autrui — la faille la plus grave qu'un export puisse avoir.
   *
   * ═══ `select` EXPLICITE PARTOUT, JAMAIS UN `include` GLOBAL ═══
   *
   * Un `include: { ... }` renverrait les colonnes AJOUTÉES PLUS TARD sans que
   * personne ne le décide. C'est exactement ainsi qu'un `passwordHash` finit
   * dans un fichier remis à l'usager. Ici, chaque champ exporté a été écrit
   * à la main : ajouter une colonne au schéma ne l'exposera jamais tout seul.
   *
   * ═══ QUATRE REQUÊTES, PAS UNE DE PLUS ═══
   *
   * En parallèle, sans N+1 : les segments viennent avec leurs trajets par un
   * `select` imbriqué, et non par une requête par trajet.
   */
  async exportPersonalData(userId: string): Promise<PersonalDataExportDto> {
    const [user, preferences, routes, carbonRecords, carbonBudgets] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          // `passwordHash` est ABSENT de cette liste, et c'est le point le
          // plus important du fichier.
          select: {
            id: true,
            email: true,
            role: true,
            createdAt: true,
            deletedAt: true,
          },
        }),

        this.prisma.userPreferences.findUnique({
          where: { userId },
          select: {
            preferredModes: true,
            pmrMode: true,
            co2BudgetWeekly: true,
            notificationsEnabled: true,
            language: true,
            theme: true,
          },
        }),

        this.prisma.route.findMany({
          // ⚠️ `Route.userId` est NULLABLE : une recherche faite sans compte
          // crée un trajet qui n'appartient à personne. Ce filtre ne ramène
          // donc que les trajets réellement enregistrés par CET usager —
          // jamais un trajet anonyme, jamais celui d'un autre.
          where: { userId },
          orderBy: { requestedAt: 'asc' },
          select: {
            id: true,
            originLat: true,
            originLng: true,
            destinationLat: true,
            destinationLng: true,
            requestedAt: true,
            totalDurationMin: true,
            totalDistanceM: true,
            ecoScore: true,
            carbonEstimate: true,
            segments: {
              orderBy: { departureTime: 'asc' },
              select: {
                id: true,
                mode: true,
                operator: true,
                line: true,
                departureTime: true,
                arrivalTime: true,
                distanceM: true,
                gtfsTripId: true,
                fromStopId: true,
                toStopId: true,
              },
            },
          },
        }),

        this.prisma.carbonRecord.findMany({
          where: { userId },
          orderBy: { date: 'asc' },
          select: {
            id: true,
            date: true,
            co2Grams: true,
            mode: true,
            distanceM: true,
            savedVsCarGrams: true,
            routeId: true,
          },
        }),

        this.prisma.carbonBudget.findMany({
          where: { userId },
          orderBy: [{ year: 'asc' }, { week: 'asc' }],
          select: {
            id: true,
            year: true,
            week: true,
            weeklyBudgetGrams: true,
            consumedWeeklyGrams: true,
          },
        }),
      ]);

    if (!user) {
      // Un jeton valide dont l'usager n'existe plus : le compte a été
      // supprimé pendant la vie du jeton. Mieux vaut le dire que rendre un
      // fichier vide qui laisserait croire à une absence de données.
      throw new NotFoundException(`Utilisateur ${userId} introuvable`);
    }

    return {
      // Un fichier que l'usager conservera : sa structure doit pouvoir être
      // identifiée dans plusieurs années.
      version: 1,
      exportedAt: new Date(),
      user,
      preferences,
      routes,
      carbonRecords,
      // TOUJOURS PRÉSENT, même vide. Aucun code n'écrit dans `CarbonBudget`
      // aujourd'hui (décision documentée en 4E-5B : le budget se CALCULE
      // depuis `CarbonRecord` plutôt que de se stocker). La table porte
      // pourtant un `userId` : elle relève donc des données personnelles, et
      // l'exporter dès maintenant garantit que le fichier restera complet le
      // jour où quelque chose y écrira.
      carbonBudgets,
    };
  }

  // Retire passwordHash avant de renvoyer l'utilisateur au controller.
  private toPublicUser<T extends { passwordHash: string }>(user: T) {
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
  }
}
