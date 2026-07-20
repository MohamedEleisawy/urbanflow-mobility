# Leçons apprises

Journal des corrections apportées par l'utilisateur et des règles qui en découlent.
À relire au début de chaque session.

---

## L001 — Vérifier l'existant avant de créer

**Contexte** : étape 1. Le dossier `projet/` existait déjà (vide) et un dossier
`dossier/` contenait la conception. Créer un dossier `urbanflow/` aurait produit
un doublon.

**Règle** : toujours inspecter l'arborescence réelle avant de scaffolder, et
demander confirmation quand l'emplacement cible est ambigu.

---

## L002 — Restreindre le périmètre d'une étape

**Contexte** : le périmètre initialement proposé (Prisma, PostGIS, PWA, CI) était
trop large. L'utilisateur l'a réduit à « une base propre qui compile ».

**Règle** : proposer le plus petit incrément vérifiable. Ne pas anticiper la
configuration d'outils dont l'étape courante n'a pas besoin.

---

## L003 — `create-next-app --no-git` crée quand même un dépôt

**Contexte** : `create-next-app` a initialisé un `.git` dans `projet/frontend`
malgré `--no-git`, ce qui aurait créé un dépôt imbriqué.

**Règle** : après tout scaffolding dans un monorepo, vérifier l'absence de `.git`
imbriqué avant le premier commit.
