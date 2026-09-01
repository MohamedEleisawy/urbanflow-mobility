import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

/**
 * Ce que la promotion rend à son appelant (étape 6-2).
 *
 * VOLONTAIREMENT MINIMAL : de quoi composer un message, et rien de plus.
 * Rendre l'usager complet exposerait `passwordHash` à une sortie de terminal.
 */
export interface PromotionResult {
  email: string;
  role: RoleEnum;
  /** Vrai si le compte était DÉJÀ administrateur : rien n'a été écrit. */
  dejaAdmin: boolean;
}
import { Prisma, RoleEnum } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddressesService } from '../addresses/addresses.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { PersonalDataExportDto } from './dto/personal-data-export.dto';
import { hashPassword } from '../common/crypto/password.util';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    // Bloc 7 : l'export RGPD lit les adresses favorites par le service qui
    // en est propriétaire, jamais par une requête recopiée.
    private readonly addressesService: AddressesService,
  ) {}

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
    const [user, preferences, addresses, routes, carbonRecords, carbonBudgets] =
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
        // ⚠️ DÉLÉGUÉ À `AddressesService`, et non recopié ici.
        //
        // Un `findMany` de plus dans ce fichier aurait fonctionné — et aurait
        // créé un SECOND endroit décidant quelles colonnes d'une adresse
        // quittent le serveur. Le jour où une colonne s'ajouterait, l'un des
        // deux l'oublierait. `findAllForUser` est déjà la réponse de
        // `GET /users/me/addresses` : l'export dit donc exactement la même
        // chose que l'écran, par construction.
        this.addressesService.findAllForUser(userId),

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
      // VERSION 2 : `addresses` s'est ajouté au bloc 7. C'est précisément
      // l'usage prévu par ce champ — un fichier `version: 1` téléchargé
      // avant cette étape reste lisible, et son absence d'adresses
      // s'explique.
      version: 2,
      exportedAt: new Date(),
      user,
      preferences,
      addresses,
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

  /**
   * Supprime LOGIQUEMENT un compte, par son identifiant.
   *
   * ⚠️ RENOMMÉE À L'ÉTAPE 6-4, et le nom précédent — `deleteMyAccount` —
   * décrivait son APPELANT, pas son comportement : la méthode a toujours pris
   * un identifiant quelconque. L'administration en a désormais besoin pour
   * agir sur le compte d'autrui, et l'appeler « mon compte » depuis
   * `AdminService` aurait rendu le code trompeur à la lecture.
   *
   * C'est la SEULE implémentation de la suppression logique. La dupliquer
   * dans `AdminService` créerait deux vérités à maintenir — et le jour où
   * l'une changerait, l'autre continuerait de faire l'ancienne chose.
   *
   * ⚠️ CETTE MÉTHODE NE VÉRIFIE NI L'EXISTENCE, NI LE DROIT D'AGIR. Elle
   * exécute, elle ne décide pas. Chaque appelant apporte sa propre règle :
   * `DELETE /users/me` prend l'identifiant du jeton (rien à vérifier) ;
   * `DELETE /admin/users/:id` vérifie d'abord que la cible existe et qu'elle
   * n'est pas l'appelant lui-même.
   *
   * ═══ SUPPRESSION LOGIQUE, ET NON PHYSIQUE ═══
   *
   * Le schéma le prescrit noir sur blanc :
   *
   *     // Suppression logique (RGPD) : jamais de DELETE physique sur ce compte.
   *     deletedAt DateTime?
   *
   * Un `delete` physique déclencherait les `onDelete: Cascade` de QUATRE
   * relations — préférences, trajets (et leurs segments), empreintes carbone,
   * budgets — et détruirait irrémédiablement l'historique. Poser une date
   * rend le compte inutilisable sans rien détruire.
   *
   * ⚠️ `userId` VIENT DU JETON. Aucune route, aucun corps, aucune query ne
   * peut le désigner : il est structurellement impossible de supprimer le
   * compte d'autrui.
   *
   * ═══ IDEMPOTENT ═══
   *
   * `updateMany` plutôt qu'`update` : sur un compte déjà supprimé — ou
   * inexistant — il ne modifie aucune ligne et ne lève pas. Un second appel
   * ne peut donc ni échouer en 500, ni surtout ÉCRASER la date de suppression
   * initiale, qui est la seule trace de quand le droit a été exercé.
   */
  async softDeleteAccount(userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      // `deletedAt: null` fait partie du filtre : c'est lui qui garantit
      // qu'une suppression déjà enregistrée n'est jamais redatée.
      where: { id: userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    // Aucune valeur de retour, et aucune erreur si rien n'a été modifié : le
    // résultat attendu — « ce compte est supprimé » — est vrai dans les deux
    // cas. Dire « déjà supprimé » n'apporterait rien à l'usager et
    // apprendrait à un attaquant qu'un compte a existé.
  }

  /**
   * Promeut un usager au rôle ADMIN, par son adresse électronique (6-2).
   *
   * ═══ AUCUNE ROUTE HTTP N'APPELLE CETTE MÉTHODE, ET C'EST VOULU ═══
   *
   * Elle n'est atteignable que par `npm run user:promote`. Exposer la
   * promotion en HTTP demanderait de répondre d'abord à une question qui n'a
   * pas de bonne réponse : QUI aurait le droit de l'appeler ? Un ADMIN — mais
   * il n'en existe aucun, et c'est précisément le problème qu'on résout. La
   * ligne de commande brise ce cercle : celui qui l'exécute a déjà l'accès au
   * serveur et à la base, donc plus de pouvoir que n'importe quelle route ne
   * lui en donnerait.
   *
   * ⚠️ LA PROMOTION NE CHANGE PAS LES JETONS DÉJÀ ÉMIS. Le rôle est signé
   * dans le JWT au moment du login (`AuthService.login`) : l'usager promu
   * doit se RECONNECTER pour obtenir un jeton portant `role: ADMIN`. C'est la
   * contrepartie d'un jeton autoportant, et elle est sans danger — un ancien
   * jeton donne moins de droits, jamais plus.
   *
   * IDEMPOTENTE : relancée sur un compte déjà ADMIN, elle n'écrit rien et le
   * signale. Ce n'est pas une erreur — le résultat attendu est atteint.
   */
  async promoteToAdmin(email: string): Promise<PromotionResult> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      // Trois colonnes, et surtout PAS `passwordHash` : cette méthode est
      // appelée depuis un terminal, dont la sortie finit dans un historique
      // de commandes et parfois dans des journaux.
      select: { id: true, email: true, role: true, deletedAt: true },
    });

    if (!user) {
      throw new NotFoundException(`Aucun utilisateur avec l'email ${email}`);
    }

    if (user.deletedAt !== null) {
      // Promouvoir un compte supprimé produirait un administrateur qui ne
      // peut pas se connecter (étape 5G) — un droit accordé à personne, et
      // une surprise le jour où quelqu'un le restaurerait.
      throw new BadRequestException(
        `Le compte ${email} est supprimé : il ne peut pas être promu.`,
      );
    }

    if (user.role === RoleEnum.ADMIN) {
      return { email: user.email, role: user.role, dejaAdmin: true };
    }

    const promu = await this.prisma.user.update({
      where: { id: user.id },
      // `role` SEUL. Aucun autre champ n'est touché : ni l'email, ni le mot
      // de passe, ni les préférences.
      data: { role: RoleEnum.ADMIN },
      select: { email: true, role: true },
    });

    return { email: promu.email, role: promu.role, dejaAdmin: false };
  }

  // Retire passwordHash avant de renvoyer l'utilisateur au controller.
  private toPublicUser<T extends { passwordHash: string }>(user: T) {
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
  }
}
