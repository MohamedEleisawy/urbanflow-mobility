# =============================================================================
# Backend NestJS — image de PRODUCTION
# =============================================================================
# Contexte de build : `./projet` (voir docker-compose.production.yml).
#
# ═══ CE QUI DISTINGUE CETTE IMAGE DE CELLE DE DÉVELOPPEMENT ═══
#
#   - aucun code source TypeScript : seul `dist/` compilé est embarqué ;
#   - aucune dépendance de développement (`--omit=dev`) ;
#   - aucun `.env` (voir `projet/.dockerignore`) : la configuration arrive
#     par variables d'environnement, à l'exécution, jamais dans l'image ;
#   - le processus tourne sous un utilisateur NON PRIVILÉGIÉ.
#
# ═══ POURQUOI `prisma` DOIT ÊTRE PRÉSENT À L'EXÉCUTION ═══
#
# ⚠️ Deux commandes en ont besoin APRÈS le déploiement, pas seulement au build :
#
#     npx prisma migrate deploy      appliquer les migrations en production
#     npx prisma generate            régénérer le client pour cette plateforme
#
# C'est pourquoi `prisma` figure dans `dependencies` et non `devDependencies` :
# avec `npm ci --omit=dev`, un `prisma` en devDependencies serait absent, et
# `npx` tenterait de le TÉLÉCHARGER à chaque appel — au risque d'installer une
# version différente de `@prisma/client`, ce qui échoue de façon obscure.
# =============================================================================

# -----------------------------------------------------------------------------
# Étape 1 — compilation
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Les dépendances d'abord, et SEULES : tant que package.json ne change pas,
# Docker réutilise cette couche et ne réinstalle rien.
COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./

# Le client Prisma est généré à partir du schéma, avant la compilation :
# le code TypeScript importe les types qu'il produit.
RUN npx prisma generate

# `nest build` compile TOUT `src/`, y compris les utilitaires en ligne de
# commande. C'est ce qui rend l'import GTFS possible en production SANS
# ts-node : `node dist/gtfs/gtfs-import.cli.js <source> CTS`.
RUN npm run build

# -----------------------------------------------------------------------------
# Étape 2 — exécution
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# ⚠️ `NODE_ENV=production` EST POSÉ AVANT `npm ci` À DESSEIN : npm s'en sert
# lui-même pour ignorer les devDependencies, en plus du drapeau explicite.
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Le schéma ET les migrations : `migrate deploy` a besoin des deux pour savoir
# ce qui a déjà été appliqué à la base.
COPY --from=builder /app/prisma ./prisma

# Régénéré ICI, dans l'image finale : le moteur de requête de Prisma est un
# binaire natif, et celui produit à l'étape 1 pourrait ne pas correspondre.
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# ⚠️ AUCUN PROCESSUS DE PRODUCTION NE TOURNE EN ROOT. L'image `node` fournit
# déjà un utilisateur `node` sans privilège ; l'application n'écrit aucun
# fichier, elle n'a donc besoin d'aucun droit supplémentaire.
USER node

EXPOSE 3001

CMD ["node", "dist/main.js"]
