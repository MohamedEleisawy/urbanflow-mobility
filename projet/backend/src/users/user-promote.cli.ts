// =============================================================================
// Promotion d'un utilisateur en administrateur (étape 6-2)
// =============================================================================
//   npm run admin:promote -- utilisateur@example.com     (alias : user:promote)
//
//   En production (image Docker, sans ts-node) :
//     node dist/users/user-promote.cli.js utilisateur@example.com
//
// ═══ POURQUOI UNE COMMANDE, ET PAS UNE ROUTE HTTP ═══
//
// La question qui tue toute route de promotion est : QUI aurait le droit de
// l'appeler ? Un administrateur — mais il n'en existe aucun, et c'est
// exactement le problème qu'on cherche à résoudre. Toute réponse HTTP à ce
// cercle serait une faille :
//
//   - route ouverte             → n'importe qui devient administrateur ;
//   - route à secret partagé    → un mot de passe de plus à protéger, et qui
//                                 finirait dans une variable d'environnement
//                                 partagée par tout le serveur ;
//   - promotion du premier      → une course : celui qui s'inscrit en premier
//     inscrit                     après un déploiement gagne le back-office.
//
// La ligne de commande brise le cercle sans rien exposer : celui qui
// l'exécute a déjà l'accès au serveur et à la base, donc DÉJÀ plus de pouvoir
// que n'importe quelle route ne lui en donnerait. On n'ajoute aucune surface
// d'attaque.
//
// C'est le même raisonnement — et la même forme — que `gtfs-import.cli.ts`
// (4C-4-3) et `gtfs-rt-import.cli.ts` (4F-1D) : la logique vit dans le
// SERVICE, ce fichier ne fait que lire un argument et rendre un code de
// sortie.
//
// ═══ CE QUE LA COMMANDE NE FAIT PAS ═══
//
//   - elle ne crée AUCUN compte : l'usager doit s'être inscrit normalement ;
//   - elle ne demande ni mot de passe, ni jeton ;
//   - elle ne touche AUCUN autre champ que `role` ;
//   - elle n'affiche jamais l'usager complet, et donc jamais `passwordHash`.
//
// ⚠️ L'usager promu doit SE RECONNECTER : son rôle est signé dans le JWT au
// moment du login, et un jeton déjà émis continue de porter « USER ».
//
// NestFactory.createApplicationContext démarre l'application SANS serveur
// HTTP : on récupère juste l'injection de dépendances, puis on referme.
// =============================================================================

import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UsersService } from './users.service';

async function main(): Promise<void> {
  const [email] = process.argv.slice(2);

  // Vérifié AVANT de démarrer l'application : inutile d'ouvrir une connexion
  // à la base pour découvrir qu'il manque un argument.
  if (!email || email.trim() === '') {
    throw new Error(
      'Adresse électronique manquante.\n' +
        '  Utilisation : npm run admin:promote -- utilisateur@example.com\n' +
        '  En production : node dist/users/user-promote.cli.js utilisateur@example.com',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(UsersService);

  try {
    const resultat = await service.promoteToAdmin(email.trim());

    if (resultat.dejaAdmin) {
      // PAS une erreur : le résultat attendu est atteint. Un code de sortie
      // non nul ferait échouer un script de déploiement rejoué, alors que
      // tout est en ordre.
      console.log(`${resultat.email} est déjà administrateur — rien à faire.`);
      return;
    }

    console.log(
      `${resultat.email} est désormais administrateur (${resultat.role}).`,
    );
    console.log(
      'Cette personne doit se RECONNECTER pour que son jeton porte le nouveau rôle.',
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  // Usager introuvable, compte supprimé, base injoignable : toutes finissent
  // en code de sortie 1. « Introuvable » n'est JAMAIS un succès — sans quoi
  // une faute de frappe dans l'adresse passerait pour une promotion réussie.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
