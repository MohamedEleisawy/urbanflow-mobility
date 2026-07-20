### 1. Mode Plan par Défaut

* Passez en mode plan pour TOUTE tâche non triviale (3 étapes ou plus, ou décisions architecturales).
* Si quelque chose déraille, ARRÊTEZ-VOUS et replanifiez immédiatement — ne forcez pas le passage.
* Utilisez le mode plan pour les étapes de vérification, pas seulement pour la construction.
* Rédigez des spécifications détaillées en amont pour réduire toute ambiguïté.

### 2. Stratégie de Sous-Agents (*Subagents*)

* Utilisez généreusement les sous-agents pour garder la fenêtre de contexte principale propre.
* Déléguez la recherche, l'exploration et l'analyse parallèle aux sous-agents.
* Pour les problèmes complexes, allouez plus de puissance de calcul via les sous-agents.
* Une seule tâche par sous-agent pour garantir une exécution ciblée.

### 3. Boucle d'Auto-Amélioration

* Après CHAQUE correction de l'utilisateur : mettez à jour `tasks/lessons.md` avec le modèle de l'erreur.
* Rédigez des règles pour vous-même afin d'éviter de reproduire la même erreur.
* Itérez impitoyablement sur ces leçons jusqu'à ce que le taux d'erreur chute.
* Passez en revue les leçons au début de chaque session pour le projet concerné.

### 4. Vérification Avant Validation

* Ne marquez jamais une tâche comme terminée sans prouver qu'elle fonctionne.
* Comparez le comportement (*diff*) entre la branche principale et vos modifications lorsque c'est pertinent.
* Demandez-vous : « Est-ce qu'un ingénieur principal (*staff engineer*) approuverait cela ? »
* Lancez les tests, vérifiez les logs, et démontrez la conformité du résultat.

### 5. Exigence d'Élégance (Équilibrée)

* Pour les changements non triviaux : faites une pause et demandez-vous : « Y a-t-il une manière plus élégante ? »
* Si une correction semble bancale (*hacky*) : « En sachant tout ce que je sais maintenant, implémente la solution élégante ».
* Ignorez cette étape pour les corrections simples et évidentes — ne sur-optimisez pas (*over-engineer*).
* Remettez en question votre propre travail avant de le présenter.

### 6. Résolution Autonome des Bugs

* Face à un rapport de bug : corrigez-le, tout simplement. Ne demandez pas qu'on vous tienne la main.
* Analysez les logs, les erreurs, les tests en échec — puis résolvez-les.
* Aucun changement de contexte (*context switching*) ne doit être imposé à l'utilisateur.
* Allez corriger les tests CI en échec sans attendre qu'on vous dise comment faire.

### 7. Sécurité par Défaut

* Ne codez jamais en dur des secrets, clés d'API, mots de passe ou jetons dans le code source — utilisez des variables d'environnement.
* Utilisez toujours des requêtes paramétrées — ne concaténez jamais les entrées utilisateur dans des requêtes SQL/NoSQL.
* Hachez les mots de passe avec bcrypt, argon2 ou scrypt — jamais avec MD5 ou SHA1.
* Nettoyez (*sanitize*) et validez TOUTES les entrées utilisateur aux frontières du système.
* Échappez les sorties pour empêcher les failles XSS (pas de `innerHTML` brut, de `dangerouslySetInnerHTML`, ou de `v-html` sans nettoyage préalable).
* Configurez les en-têtes de sécurité : HSTS, X-Frame-Options, X-Content-Type-Options, Content-Security-Policy.
* Configurez le CORS de manière restrictive — n'utilisez jamais le caractère générique `*` en production.
* Implémentez une limitation de débit (*rate limiting*) sur les points de terminaison d'authentification.
* Utilisez des jetons CSRF pour les opérations qui modifient l'état de l'application.
* Ne détaillez jamais les piles d'exécution (*stack traces*), les infos de débogage ou les erreurs verbeuses en production.
* Assurez-vous que le fichier `.gitignore` inclut le `.env`, les clés privées, les identifiants et les logs.
* Privilégiez le HTTPS partout — redirigez le HTTP vers le HTTPS.
* Appliquez le principe du moindre privilège sur tous les contrôles d'accès.

---

## Gestion des Tâches

1. **Planifier d'abord** : Écrivez le plan dans `tasks/todo.md` avec des éléments cochables.
2. **Vérifier le plan** : Faites valider le plan avant de commencer l'implémentation.
3. **Suivre la progression** : Cochez les éléments au fur et à mesure de votre avancement.
4. **Expliquer les changements** : Fournissez un résumé de haut niveau à chaque étape.
5. **Documenter les résultats** : Ajoutez une section de révision à `tasks/todo.md`.
6. **Consigner les leçons** : Mettez à jour `tasks/lessons.md` après chaque correction.

---

## Principes Fondamentaux

* **La simplicité d'abord** : Rendez chaque changement aussi simple que possible. Impactez un minimum de code.
* **Pas de paresse** : Trouvez les causes racines. Pas de correctifs temporaires. Standard de développeur senior exigé.
* **Sécurisé par conception (*Secure by Design*)** : La sécurité n'est pas une phase de développement — elle est intégrée à chaque ligne de code.