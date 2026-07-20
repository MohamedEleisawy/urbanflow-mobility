# Image de développement du frontend Next.js.
# Volontairement simple à ce stade : le build multi-stage de production
# sera introduit lors de l'étape de déploiement.
FROM node:22-alpine

WORKDIR /app

# Les dépendances sont copiées seules d'abord : la couche est mise en cache
# tant que package.json / package-lock.json ne changent pas.
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./

EXPOSE 3000
CMD ["npm", "run", "dev"]
