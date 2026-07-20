# ADR 0001 — Architecture technique imposée

- **Statut** : accepté
- **Date** : 2026-07-20

## Contexte

Le dossier de conception d'UrbanFlow Mobility fige la pile technique avant le
début du développement. Cette décision est enregistrée pour éviter toute dérive
au fil des étapes d'implémentation.

## Décision

| Domaine            | Choix retenu                                    |
| ------------------ | ----------------------------------------------- |
| Frontend           | Next.js 16, App Router, TypeScript, Tailwind CSS |
| Cartographie       | React Leaflet + OpenStreetMap                    |
| Backend            | NestJS, REST, JWT, Prisma ORM                    |
| Calcul carbone     | Microservice FastAPI (Python)                    |
| Base de données    | PostgreSQL + PostGIS                             |
| Cache              | Redis                                            |
| Conteneurisation   | Docker + Docker Compose                          |
| Déploiement        | Vercel (frontend), Render ou Railway (backend)   |

## Justifications

- **NestJS plutôt qu'Express** : architecture modulaire, injection de dépendances
  et découpage en modules alignés sur les principes SOLID ; adapté à un projet
  destiné à évoluer et à être soutenu devant un jury.
- **PostgreSQL + PostGIS plutôt que SQLite** : les calculs d'itinéraires reposent
  sur des requêtes géospatiales (distances, recherche d'arrêts proches) que seul
  PostGIS fournit nativement.
- **FastAPI pour le calcul carbone** : isolation d'un domaine métier autonome dans
  un service dédié, dans un écosystème Python adapté au calcul scientifique. Le
  service peut évoluer et être testé indépendamment du backend.
- **Redis** : le diagramme de séquence prévoit explicitement une mise en cache des
  itinéraires calculés récemment (fenêtre de 30 s).

## Conséquences

- Aucune substitution technologique n'est autorisée sans nouvel ADR.
- Chaque service est conteneurisé et démarrable indépendamment.
- Le backend NestJS est le seul point d'entrée du frontend ; il orchestre les
  appels vers le microservice carbone.
