// Charge projet/backend/.env (DATABASE_URL...) dans process.env avant tout
// le reste. Nécessaire uniquement en local : en Docker, ces variables sont
// déjà injectées par docker-compose.yml.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { optionsCors } from './config/cors.config';
import { entetesDeSecurite } from './config/security-headers.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // En-têtes de sécurité (7-1) : posés AVANT tout le reste, pour qu'une
  // réponse d'erreur produite en amont les porte elle aussi.
  app.use(entetesDeSecurite);

  // ⚠️ La configuration CORS vient de `config/cors.config.ts`, et le test e2e
  // l'importe du MÊME endroit. Elle était auparavant écrite ici et RECOPIÉE
  // dans le test : c'est ainsi que `PATCH` a pu manquer pendant deux blocs
  // sans qu'aucun test n'échoue (étape 7-1).
  app.enableCors(optionsCors());

  // Valide automatiquement le corps de chaque requête contre les DTOs
  // (class-validator). whitelist retire les champs non déclarés dans le DTO ;
  // forbidNonWhitelisted rejette la requête (400) si le client en envoie.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Toutes les routes REST sont préfixées par /api pour laisser la racine
  // libre (health checks des plateformes de déploiement, documentation...).
  app.setGlobalPrefix('api');

  await ecouter(app);
}

/**
 * Démarre le serveur, en expliquant les deux pannes qui arrivent réellement.
 *
 * ═══ POURQUOI CETTE FONCTION EXISTE ═══
 *
 * `app.listen()` seul produit, quand le port est pris, une trace de trente
 * lignes se terminant par `EADDRINUSE` — au milieu de laquelle il faut deviner
 * qu'une AUTRE instance tourne déjà, et que le remède est de l'arrêter. Le
 * même écran illisible apparaît quand PostgreSQL est éteint.
 *
 * Ces deux pannes représentent la quasi-totalité des démarrages ratés en
 * développement. Elles méritent une phrase, pas une pile d'appels.
 *
 * ⚠️ ON NE BASCULE PAS SUR UN AUTRE PORT. Le réflexe « port occupé, j'en prends
 * un autre » est un piège : le frontend continue d'appeler `:3001`, et l'on se
 * retrouve avec un backend qui tourne et une application qui ne le voit pas —
 * panne bien plus longue à diagnostiquer que celle qu'on croyait éviter.
 */
async function ecouter(app: INestApplication): Promise<void> {
  // ⚠️ `PORT` EST LU ICI ET NULLE PART AILLEURS. La même valeur est déclarée
  // dans `docker-compose.yml` (`PORT: 3001`) et consommée par le frontend via
  // `NEXT_PUBLIC_API_URL`. Trois fichiers, une seule valeur.
  //
  // 3001 par défaut : le port 3000 est occupé par le frontend Next.js en local.
  const port = Number(process.env.PORT ?? 3001);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`
  PORT invalide : « ${process.env.PORT} ».
  Attendu : un entier entre 1 et 65535. Exemple : PORT=3001
`);
    process.exit(1);
  }

  try {
    await app.listen(port);
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`
  Le port ${port} est déjà utilisé.

  Une autre instance du backend tourne probablement déjà.
  Pour trouver laquelle :

      netstat -ano | findstr :${port}        (Windows)
      lsof -i :${port}                       (macOS / Linux)

  Arrêtez-la, puis relancez. Ne changez PAS de port : le frontend appelle
  ${port} via NEXT_PUBLIC_API_URL, et un backend écoutant ailleurs lui
  serait invisible.
`);
      process.exit(1);
    }

    throw erreur;
  }

  console.log(`  UrbanFlow API : http://localhost:${port}/api`);
}

/**
 * ⚠️ LE REJET DE `bootstrap()` DOIT ÊTRE ATTRAPÉ. Sans ce `catch`, une
 * promesse rejetée — PostgreSQL injoignable, typiquement — remonte en
 * `unhandledRejection` et Node affiche une pile brute qui ne dit pas ce qui
 * manque.
 */
bootstrap().catch((erreur: unknown) => {
  const message = erreur instanceof Error ? erreur.message : String(erreur);

  // La panne de loin la plus fréquente en local : Docker Desktop arrêté.
  if (message.includes("Can't reach database server")) {
    console.error(`
  Base de données injoignable.

  ${message.split('\n')[0]}

  Le conteneur PostgreSQL est probablement arrêté. Démarrez-le :

      docker compose up -d postgres

  (Sous Windows, vérifiez d'abord que Docker Desktop est lancé.)
`);
    process.exit(1);
  }

  console.error(erreur);
  process.exit(1);
});
