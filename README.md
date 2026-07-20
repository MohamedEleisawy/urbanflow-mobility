# UrbanFlow Mobility

Plateforme web de mobilité urbaine multimodale et éco-responsable : recherche
d'itinéraire, carte interactive, prise en compte des perturbations et calcul de
l'empreinte carbone des trajets.

Projet de fin d'études — le dossier de conception (diagrammes UML, spécifications)
se trouve dans [`dossier/`](dossier/).

---

## Architecture

| Composant          | Technologie                                                      | Port  |
| ------------------ | ---------------------------------------------------------------- | ----- |
| `frontend/`        | Next.js 16 (App Router), TypeScript, Tailwind CSS 4, React 19     | 3000  |
| `backend/`         | NestJS 11, REST, TypeScript strict, Prisma ORM _(à venir)_        | 3001  |
| `carbon-service/`  | FastAPI, Python 3.13, Pydantic v2                                 | 8000  |
| Base de données    | PostgreSQL + PostGIS _(à venir)_                                  | 5432  |
| Cache              | Redis _(à venir)_                                                 | 6379  |

Le backend NestJS orchestre les appels : il interroge le microservice FastAPI
pour obtenir la distance, les émissions de CO₂ et l'EcoScore d'un itinéraire.

### Arborescence

```
URBAN_FLOW_MOBILITY/
├── dossier/                  # Dossier de conception (UML, PDF)
├── projet/                   # Code source du monorepo
│   ├── frontend/             # Application Next.js
│   ├── backend/              # API NestJS
│   ├── carbon-service/       # Microservice FastAPI
│   ├── docker/               # Dockerfiles par service
│   └── docs/                 # Documentation technique
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Démarrage rapide

### Prérequis

- Node.js 22+
- Python 3.11+
- Docker et Docker Compose (optionnel)

### Configuration

```bash
cp .env.example .env
```

Aucun secret n'est versionné : `.env` est ignoré par Git.

### En local, service par service

**Frontend** — <http://localhost:3000>

```bash
cd projet/frontend
npm install
npm run dev
```

**Backend** — <http://localhost:3001/api>

```bash
cd projet/backend
npm install
npm run start:dev
```

**Microservice carbone** — <http://localhost:8000/docs>

```bash
cd projet/carbon-service
python -m venv .venv
.venv\Scripts\activate        # Windows
source .venv/bin/activate     # Linux / macOS
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

### Avec Docker

```bash
docker compose up --build
```

---

## Qualité de code

| Commande                            | Effet                                  |
| ----------------------------------- | -------------------------------------- |
| `npm run lint` (frontend / backend) | Analyse statique ESLint                |
| `npm run format`                    | Formatage Prettier                     |
| `npm run typecheck` (frontend)      | Vérification TypeScript sans émission  |
| `npm test` (backend)                | Tests unitaires Jest                   |
| `ruff check .` (carbon-service)     | Lint Python                            |
| `pytest` (carbon-service)           | Tests unitaires                        |

TypeScript est en mode `strict` sur le frontend et le backend ; Python est typé
et vérifié par mypy en mode `strict`.

---

## Feuille de route

- [x] **Étape 1** — Structure du monorepo et configuration initiale
- [ ] **Étape 2** — PostgreSQL + PostGIS, Prisma, modèle de données
- [ ] **Étape 3** — Authentification JWT, inscription et connexion
- [ ] **Étape 4** — Recherche d'itinéraire et cache Redis
- [ ] **Étape 5** — Calcul carbone (FastAPI) et EcoScore
- [ ] **Étape 6** — Carte interactive React Leaflet, PWA
- [ ] **Étape 7** — Espace utilisateur, budget carbone, export RGPD
- [ ] **Étape 8** — Back-office d'administration et statistiques
- [ ] **Étape 9** — Déploiement (Vercel / Render)

---

## Licence

Projet académique — tous droits réservés.
