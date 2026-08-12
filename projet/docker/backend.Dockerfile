# Image de développement de l'API NestJS.
FROM node:22-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./

# Génère le client Prisma (code TypeScript typé d'accès à la base) à partir
# de prisma/schema.prisma. Nécessaire ici car prisma/ n'existe pas encore
# au moment du "npm ci" ci-dessus.
RUN npx prisma generate

EXPOSE 3001
CMD ["npm", "run", "start:dev"]
