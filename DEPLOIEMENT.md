# Déploiement en production — UrbanFlow Mobility

Toutes les commandes ci-dessous ont été **exécutées et vérifiées** sur le poste
de développement (Docker Compose v5.4.0) avant d'être écrites ici.

Architecture visée :

```
Navigateur ──► Vercel (frontend Next.js)
                    │  appels API en HTTPS
                    ▼
         https://api.mon-domaine.fr
                    │
                  Caddy  (certificat Let's Encrypt automatique)
                    │  réseau Docker interne
                    ▼
              backend:3001  (NestJS)
                    ├──► postgres:5432  (PostgreSQL + PostGIS)
                    └──► carbon-service:8000  (FastAPI)
```

---

## ⚠️ La règle qui fait échouer la moitié des déploiements

`--env-file .env.production` doit être passé à **CHAQUE** commande
`docker compose`, pas seulement à `up`.

```bash
# ✗ ÉCHOUE : « required variable JWT_SECRET is missing a value »
docker compose -f docker-compose.production.yml ps

# ✓ CORRECT
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

Sans le fichier, Compose ne peut pas résoudre `${JWT_SECRET:?…}` et s'arrête —
y compris pour un simple `ps` ou `logs`. Pour s'épargner la répétition :

```bash
alias ufc='docker compose --env-file .env.production -f docker-compose.production.yml'
ufc ps
ufc logs -f backend
```

---

## 1. Préparer le serveur OVH

```bash
ssh utilisateur@IP_DU_SERVEUR

sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sh

# Utiliser docker sans sudo (déconnexion/reconnexion nécessaire ensuite)
sudo usermod -aG docker $USER

docker --version
docker compose version
```

## 2. Récupérer le projet

```bash
git clone https://github.com/VOTRE_COMPTE/URBAN_FLOW_MOBILITY.git
cd URBAN_FLOW_MOBILITY
```

## 3. Créer le fichier de secrets — sur le serveur uniquement

```bash
cp .env.production.example .env.production
nano .env.production
chmod 600 .env.production
```

Générer les deux secrets, ne pas les inventer :

```bash
openssl rand -hex 32      # → JWT_SECRET
openssl rand -base64 24   # → POSTGRES_PASSWORD
```

⚠️ `.env.production` est couvert par `.gitignore`. **Ne le committez jamais.**
Vérification :

```bash
git check-ignore -v .env.production   # doit répondre .gitignore:17:.env.*
```

## 4. Démarrer

```bash
docker compose --env-file .env.production \
  -f docker-compose.production.yml up -d --build
```

Contrôles :

```bash
docker compose --env-file .env.production -f docker-compose.production.yml ps
docker compose --env-file .env.production -f docker-compose.production.yml logs -f backend
```

Attendu — le backend passe en `healthy` après ~20 s :

```
SERVICE          STATUS
backend          Up (healthy)
carbon-service   Up
postgres         Up (healthy)
```

## 5. Base de données

```bash
C="docker compose --env-file .env.production -f docker-compose.production.yml"

# Appliquer les migrations (14 migrations)
$C exec backend npx prisma migrate deploy
```

## 6. Importer le réseau CTS de Strasbourg

⚠️ **La commande de production n'est PAS `npm run gtfs:import`.** Ce script
passe par `ts-node`, absent de l'image de production — et le code TypeScript
n'y est pas non plus. Le CLI compilé est utilisé à la place :

```bash
$C exec backend node dist/gtfs/gtfs-import.cli.js \
  https://opendata.cts-strasbourg.eu/google_transit.zip CTS
```

Durée mesurée : **45 secondes**. Attendu en fin de sortie :

```
arrêts   : 1348
lignes   : 47
liaisons : 1984
Passages théoriques importés : 710302
```

Vérification immédiate :

```bash
curl -s http://localhost:3001/api/stops/modes
# {"modes":[{"mode":"BUS","lineCount":41},{"mode":"TRAM","lineCount":6}]}
```

## 7. HTTPS avec Caddy

Prérequis : un enregistrement DNS **A** pointant vers l'IP du serveur, et les
ports 80 et 443 ouverts.

```bash
echo "API_DOMAIN=api.mon-domaine.fr" >> .env.production

docker compose --env-file .env.production \
  -f docker-compose.production.yml \
  -f docker-compose.caddy.yml \
  up -d --build
```

Cette surcouche **retire la publication du port 3001** : l'API n'est plus
joignable qu'à travers Caddy, en HTTPS. Le certificat est obtenu et renouvelé
automatiquement.

```bash
curl -s https://api.mon-domaine.fr/api/territory
```

## 8. Connecter le frontend Vercel

Sur Vercel, variable d'environnement du projet :

```
NEXT_PUBLIC_API_URL = https://api.mon-domaine.fr/api
```

Puis, dans `.env.production` du serveur, autoriser cette origine et relancer :

```
FRONTEND_URL=https://votre-projet.vercel.app
APP_PUBLIC_URL=https://votre-projet.vercel.app
```

```bash
docker compose --env-file .env.production \
  -f docker-compose.production.yml -f docker-compose.caddy.yml up -d
```

⚠️ `FRONTEND_URL` alimente le CORS : sans elle, seul `localhost:3000` est
autorisé et le frontend Vercel se verra refuser **toutes** ses requêtes.
`APP_PUBLIC_URL` sert au lien de réinitialisation de mot de passe.

## 9. Promouvoir un compte administrateur

Il n'existe **aucune route HTTP** de promotion, et c'est voulu : personne ne
pourrait l'appeler légitimement tant qu'aucun administrateur n'existe. La
promotion se fait en ligne de commande, depuis le serveur — celui qui y a accès
a déjà plus de pouvoir que n'importe quelle route ne lui en donnerait.

⚠️ **La commande de production n'est PAS `npm run admin:promote`.** Ce script
passe par `ts-node`, absent de l'image de production. Le CLI compilé
(`dist/`, produit par `nest build`) est utilisé à la place :

```bash
# Le compte doit s'être inscrit normalement AU PRÉALABLE (page /inscription).
docker compose --env-file .env.production -f docker-compose.production.yml \
  exec backend node dist/users/user-promote.cli.js mon-email@example.com
```

Sortie attendue :

```
mon-email@example.com est désormais administrateur (ADMIN).
Cette personne doit se RECONNECTER pour que son jeton porte le nouveau rôle.
```

La commande :

- refuse un email inconnu (`Aucun utilisateur avec l'email …`, code de sortie 1) ;
- refuse un compte supprimé ;
- ne touche **que** le champ `role` — jamais l'email, le mot de passe, les préférences ;
- n'affiche jamais `passwordHash` ni `JWT_SECRET` ;
- est idempotente : relancée sur un compte déjà ADMIN, elle le signale sans rien écrire.

Après reconnexion, le lien « Administration » apparaît dans l'en-tête et
`/mon-espace` affiche « Administrateur ». Vérifier la session courante :

```bash
curl -s https://api.mon-domaine.fr/api/users/me -H "Authorization: Bearer <JWT>"
# → { "id", "email", "role": "ADMIN", "createdAt", "preferences" } — jamais passwordHash
```

---

## Mettre à jour l'application

⚠️ **`migrate deploy` N'EST PAS OPTIONNEL.** Une mise à jour qui ajoute une
colonne (par ex. `routes.mode` pour les trajets marche/vélo directs) et qu'on
oublie de migrer produit un **500 « Internal server error » à l'enregistrement
d'un trajet** : le code écrit une colonne que la base n'a pas encore. Le motif
exact est alors visible dans `docker logs backend` (`Prisma P2022 …`).

```bash
git pull
docker compose --env-file .env.production \
  -f docker-compose.production.yml -f docker-compose.caddy.yml up -d --build
# TOUJOURS après un up qui a reconstruit l'image :
docker compose --env-file .env.production \
  -f docker-compose.production.yml exec backend npx prisma migrate deploy
```

## Dépannage

### « Internal server error » à l'enregistrement d'un trajet

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  logs --tail=50 backend | grep -i "enregistrement\|Prisma"
```

- `Prisma P2022 … routes.mode` → migration oubliée : lancez `migrate deploy` (ci-dessus).
- `P2003` (clé étrangère) ou `503 carbone` → le microservice carbone ne répond
  pas ; vérifiez `docker compose … ps` (le service `carbon-service` doit être `Up`).

### Le tracé vélo (ou piéton) traverse les maisons en ligne droite

Le routage rue par rue n'est pas actif. Au démarrage, le backend le dit :

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  logs backend | grep -i "Routage vélo\|Routage piéton"
# Attendu : « Routage vélo ACTIF (valhalla) »
# Sinon   : « Routage vélo NON CONFIGURÉ … »
```

Vérification publique :

```bash
curl -s https://api.mon-domaine.fr/api/capabilities
# bikeRouting doit être { "status": "CONFIGURED", "provider": "valhalla" }
```

Depuis cette version, `docker-compose.production.yml` **pointe par défaut sur
l'instance publique Valhalla d'OpenStreetMap** (`valhalla1.openstreetmap.de`).
Un simple `up -d --build backend` suffit donc à réactiver le routage — il n'y a
plus rien à ajouter dans `.env.production`. Pour héberger votre propre Valhalla,
renseignez `WALK_ROUTING_BASE_URL` / `BIKE_ROUTING_BASE_URL`.

Si le service est réellement injoignable depuis le serveur (pare-feu sortant,
quota atteint), le disjoncteur le journalise et le tracé retombe **honnêtement**
sur une estimation en pointillés — jamais une ligne droite présentée comme une
vraie route.

## Sauvegarder la base

```bash
docker compose --env-file .env.production -f docker-compose.production.yml \
  exec -T postgres pg_dump -U urbanflow urbanflow | gzip > sauvegarde-$(date +%F).sql.gz
```

## Dépendances extérieures et comportement en panne

| Service | Rôle | Si indisponible |
|---|---|---|
| Valhalla (OSM) — profil `pedestrian` | tracé piéton rue par rue | La marche redevient une **estimation à vol d'oiseau**, annoncée comme telle et tracée en pointillés. Un disjoncteur cesse d'appeler pendant 60 s après 3 échecs, pour que la recherche reste rapide. **Vérifié en conditions réelles.** |
| Valhalla (OSM) — profil `bicycle` | tracé vélo rue par rue (bouton « Vélo uniquement ») | Le trajet vélo devient une **estimation à vol d'oiseau** (« Itinéraire vélo estimé », pointillés). Disjoncteur propre au profil vélo : une panne côté `bicycle` ne coupe pas le piéton. Le bouton « Vélo uniquement » reste proposé — le repli est honnête, pas un blocage. |
| Nominatim (OSM) | recherche d'adresses | `503` sur `/api/geocoding/search`, avec un message clair. Le reste de l'API continue de fonctionner. |
| Vélhop (nextbike) | vélos en libre-service | La couche vélo affiche « données indisponibles ». Aucune station inventée. |
| carbon-service | calcul du CO₂ | Les itinéraires sont rendus avec `carbon.status = CARBON_UNAVAILABLE` et des champs à `null` — **jamais 0 g**. |

Aucune de ces pannes ne rend la recherche d'itinéraire indisponible.
