# Image de développement de l'API NestJS.
FROM node:22-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./

EXPOSE 3001
CMD ["npm", "run", "start:dev"]
