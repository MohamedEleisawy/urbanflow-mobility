// Charge projet/backend/.env (DATABASE_URL...) dans process.env avant tout
// le reste. Nécessaire uniquement en local : en Docker, ces variables sont
// déjà injectées par docker-compose.yml.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
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

  // 3001 par défaut : le port 3000 est occupé par le frontend Next.js en local.
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
