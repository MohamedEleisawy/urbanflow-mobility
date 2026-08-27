// Charge projet/backend/.env (DATABASE_URL...) dans process.env avant tout
// le reste. Nécessaire uniquement en local : en Docker, ces variables sont
// déjà injectées par docker-compose.yml.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

/// Origines autorisées à appeler l'API depuis un navigateur.
///
/// AJOUTÉ À L'ÉTAPE 5A-3, et pour une raison concrète : c'est le premier
/// moment où un navigateur appelle cette API. Le frontend Next.js sert sur
/// le port 3000, l'API sur le 3001 — deux ORIGINES différentes. Sans en-tête
/// `Access-Control-Allow-Origin`, le navigateur reçoit bien la réponse mais
/// REFUSE de la transmettre au JavaScript de la page. Les appels en ligne de
/// commande, eux, n'ont jamais été concernés : CORS est une protection du
/// navigateur, pas du serveur.
///
/// JAMAIS `*`. Le dossier de conception l'écrit noir sur blanc (§3.1.2) :
/// « Les en-têtes CORS sont configurés pour n'accepter que les requêtes du
/// domaine Vercel du frontend ». Une origine générique laisserait n'importe
/// quel site appeler cette API depuis le navigateur d'un usager connecté.
///
/// Plusieurs origines se déclarent séparées par des virgules — le
/// déploiement (Vercel) et le développement local peuvent coexister.
function originesAutorisees(): string[] {
  const configurees = process.env.FRONTEND_URL?.trim();

  // Repli sur le port de développement, comme CARBON_SERVICE_URL (4D-2) : il
  // est PLAUSIBLE, puisque c'est là que `npm run dev` sert le frontend. Un
  // repli n'est légitime que lorsqu'il correspond à une réalité.
  if (!configurees) {
    return ['http://localhost:3000'];
  }

  return configurees
    .split(',')
    .map((origine) => origine.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: originesAutorisees(),
    // Les verbes réellement exposés par l'API. En lister d'autres ne
    // « bloquerait » rien de plus, mais annoncerait des capacités absentes.
    methods: ['GET', 'POST', 'DELETE'],
    // Authorization : le jeton JWT. Content-Type : les corps JSON.
    allowedHeaders: ['Content-Type', 'Authorization'],
    // PAS de `credentials: true` : l'authentification passe par un en-tête
    // Authorization, pas par un cookie. L'activer ouvrirait l'envoi
    // automatique de cookies entre origines sans qu'aucun cookie n'existe.
  });

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
