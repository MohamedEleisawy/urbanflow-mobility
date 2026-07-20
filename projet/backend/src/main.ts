import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Toutes les routes REST sont préfixées par /api pour laisser la racine
  // libre (health checks des plateformes de déploiement, documentation...).
  app.setGlobalPrefix('api');

  // 3001 par défaut : le port 3000 est occupé par le frontend Next.js en local.
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
