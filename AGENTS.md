# AGENTS.md — contrat de travail

> Ce fichier est lu au début de **chaque** session. Il prime sur toute habitude,
> tout tutoriel et toute convention apprise ailleurs. En cas de contradiction
> entre ce fichier et une pratique répandue, **ce fichier gagne**.

---

## 1. Le produit en cinq lignes

Swap outille les vendeuses camerounaises qui vendent **déjà** sur WhatsApp.
On n'y déplace pas la transaction : on ajoute par-dessus la conversation un
catalogue partageable, un lien de paiement mobile money, un suivi de commande
et une réputation vérifiée. L'acheteuse et la vendeuse continuent de se parler
sur WhatsApp — c'est un invariant produit, pas une étape transitoire.

**La valeur numéro un n'est pas le catalogue. C'est la preuve de paiement
opposable** : un reçu à code vérifiable, dans un marché où la capture d'écran
MoMo truquée est l'arnaque la plus courante, dans les deux sens.

---

## 2. Contraintes non négociables

Toute violation d'un point de cette section est un défaut bloquant, même si le
code fonctionne et que les tests passent.

### Argent
- Le franc CFA **n'a pas de sous-unité**. Tous les montants sont des **entiers**,
  suffixés `_xaf`. Jamais de `float`, jamais de `decimal`, jamais de division
  sans arrondi explicite et testé.
- Un acompte de 50 % sur 7 501 F vaut **3 751 F**, et le solde **3 750 F**.
  L'invariant `amount_paid_xaf + balance_xaf = total_xaf` est garanti par une
  contrainte de base de données, pas par le code applicatif.
- Aucune donnée de carte bancaire ne transite par nos serveurs, jamais.

### Paiement

**L'invariant d'architecture le plus important du produit :**

> **Les fonds ne transitent jamais par un compte contrôlé par Swap.**
> Ils vont du portefeuille de l'acheteuse vers celui de la vendeuse. Swap
> initie l'ordre et lit le statut — rien d'autre.

Ce n'est pas une préférence, c'est ce qui définit la nature du produit. Le
statut réglementé d'« établissement de paiement » (Règlement CEMAC 04/18) est
détenu par ceux qui **opèrent** le réseau et détiennent les fonds — Orange
Money Cameroun S.A., agréée par arrêté n° 00000373/MINFI du 5 mai 2022, et
Mobile Money Corporation pour MTN. Swap **utilise** ces réseaux, il n'en crée
aucun. Utiliser un service de paiement n'est pas en fournir un : sinon toute
boutique en ligne acceptant MoMo serait en infraction.

Deux corollaires qui découlent directement de l'invariant :

1. **On ne peut pas prélever de commission sur un flux qu'on ne détient pas.**
   Le revenu vient de l'abonnement, pas du paiement. Ce qui était déjà une
   nécessité concurrentielle (le dépôt MoMo direct est gratuit) est en plus
   une conséquence structurelle.
2. **La vendeuse encaisse sur le portefeuille mobile de son choix.** Elle en a
   déjà un : il n'y a aucun compte à ouvrir, aucun registre de commerce à
   fournir. Le paiement passe par un agrégateur agréé en **modèle
   sous-marchand** — la vendeuse est le bénéficiaire enregistré, avec son
   propre numéro, et l'agrégateur reverse chez elle. Voir ADR 0007.

**Le numéro de reversement est un champ distinct du numéro de connexion**,
vérifié par son propre OTP. La double SIM est la norme : une vendeuse se
connecte avec sa puce MTN et veut être payée sur son Orange Money. Toute
modification de ce numéro exige une nouvelle vérification — c'est le champ
qu'un attaquant chercherait à détourner.

- Le contenu d'un webhook **n'est jamais une preuve**. Séquence obligatoire :
  vérifier la signature HMAC en comparaison à temps constant → répondre `200`
  immédiatement → mettre en file → **re-vérifier le statut auprès de l'API de
  l'agrégateur** → appliquer de façon idempotente.
- `WAITING_FOR_CUSTOMER` **n'est pas un échec**. C'est l'acheteuse qui n'a pas
  encore saisi son code secret ; cela prend couramment une à trois minutes.
  Afficher « paiement échoué » à ce moment est le bug le plus coûteux du projet.
- L'idempotence repose sur `UNIQUE(provider_tx_id, status)` en base, pas sur un
  `if` applicatif.
- **Ne jamais réconcilier par numéro de téléphone.** Double SIM et paiement
  depuis le téléphone d'un tiers sont la norme. La clé est la référence de
  transaction ; le numéro n'est qu'un indice secondaire.

### Contexte camerounais
- **Il n'existe pas d'adresse postale.** Aucun champ `address`. La livraison se
  saisit en `{ mode, city, quartier, landmark, phone, geo? }`, avec `landmark`
  et `phone` obligatoires. Le point de retrait convenu est un mode de livraison
  de plein droit, pas un cas dégradé.
- Le message WhatsApp généré doit être **autosuffisant en texte brut** : article,
  quantité, prix, total, référence, code. Le lien est un confort, jamais le seul
  porteur d'information — certains acheteurs sont sur un forfait où les liens
  externes peuvent échouer.
- Interface en français simple. Prévoir dès la conception les variantes anglais
  et pidgin pour les **messages sortants**. Le pidgin n'est pas réservé aux
  régions anglophones.
- Le dépôt MoMo direct hors système existe et existera toujours. Il se déclare
  manuellement, fait avancer la commande, et est marqué **non vérifié**. On ne
  cherche pas à le bloquer.

### Performance — c'est ce que « premium » veut dire ici
- Boutique publique : **≤ 30 Ko de JS** compressés sur le chemin critique,
  **≤ 120 Ko** de poids total en première visite. La CI échoue au dépassement.
- **Aucune police téléchargée** sur la boutique publique. Pile système.
  Une police de marque est tolérée dans l'app vendeuse (mise en cache par le
  service worker), sous-ensemblée et préchargée.
- LCP < 2,5 s et INP < 200 ms en profil **Slow 4G bridé**, pas en local.
- Les tests de bout en bout s'exécutent sur un profil mobile bas de gamme bridé.

### Accessibilité
- **WCAG 2.2 niveau AA.** Zéro violation bloquante axe-core dans la CI.
- Cibles tactiles **≥ 44 px**.
- Le champ OTP **doit** accepter le collage et l'auto-remplissage SMS
  (critère 3.3.8). Bloquer le collage est une régression, pas une sécurité.
- `prefers-reduced-motion` respecté partout, sans exception.
- Chaque écran possède ses quatre états : chargement, vide, erreur, **hors ligne**.

---

## 3. Stack — versions figées

Vérifiées le 28/07/2026. Ne pas mettre à jour une version majeure sans ADR.

| Rôle | Choix | Version |
|---|---|---|
| Boutique publique | Astro | 7.1.x |
| App vendeuse | React Router (SPA + PWA) | 8.3.x |
| API | Hono sur Node | 4.12.x / Node 24 LTS |
| Base | PostgreSQL | 18.x |
| ORM | Prisma | 7.9.x |
| Auth | Better Auth + plugin `phoneNumber` | 1.6.x |
| Jobs | pg-boss | 12.x |
| Style | Tailwind (config CSS-first) | 4.3.x |
| Composants | shadcn CLI sur Base UI | 4.16.x / 1.6.x |
| Animation | Motion (imports ciblés) | 12.43.x |
| **TypeScript** | **6.x — PAS 7** | TS 7 ne supporte pas encore Astro |
| Outils | pnpm 11 · Biome 2.5 · Vitest 4.1 · Playwright 1.62 | |

### Pièges de version — ces habitudes sont périmées en 2026
- ❌ `tailwind.config.js` → la configuration est en CSS via `@theme`.
- ❌ `.eslintrc.js` → ESLint 10 impose la flat config ; ici on utilise **Biome**.
- ❌ Jest, webpack → Vitest et Vite.
- ❌ Lucia, `oslo` → dépréciés sur npm.
- ❌ Auth.js / NextAuth v5 → en bêta depuis plus de deux ans.
- ❌ Drizzle → pas de 1.0 stable ; on utilise Prisma 7.
- ❌ Node 18 et 20 → fin de vie.
- ❌ `middleware.ts`, `next lint`, `experimental.ppr`, params synchrones → conventions Next abandonnées.

---

## 4. Structure du dépôt

```
apps/shop      Astro — catalogue public, page de vérification de reçu, suivi
apps/seller    React Router SPA + service worker
apps/api       Hono
  src/domain   logique métier pure, testable sans base ni réseau
  src/adapters agrégateurs de paiement, SMS, stockage — derrière interfaces
  src/routes   HTTP mince : valide, délègue, sérialise
  src/jobs     pg-boss
packages/contracts  schémas Zod partagés = source de vérité des types
packages/db         schéma Prisma, migrations, seeds
packages/ui         jetons de design + primitives
docs/adr            une décision = un fichier numéroté, jamais réécrit
```

**Règle de dépendance** : `domain` ne dépend de rien. `routes` et `jobs`
dépendent de `domain`. Les `adapters` implémentent des interfaces définies dans
`domain`. Aucun import de Prisma dans `domain`.

---

## 5. Conventions

- **Conventional Commits**, versionnage sémantique.
- **Trunk-based** : branches courtes, squash, `main` toujours déployable.
- Migrations en **expand / contract** : ajouter, double-écrire, migrer les
  lectures, retirer. Jamais de changement destructif en une étape.
- Tout ce qui touche à l'argent ou au statut d'une commande écrit dans le
  journal d'audit en ajout seul.
- Les types viennent des schémas Zod de `packages/contracts`. On ne redéclare
  jamais un type à la main de part et d'autre d'une frontière.

---

## 6. Méthode de travail attendue

1. **Un lot par session.** Ne jamais entamer le lot suivant, même s'il paraît
   trivial. Un agent qui reçoit trois lots en livre trois moitiés.
2. **Lire avant d'écrire.** `AGENTS.md`, les ADR concernés, et le code existant
   du module touché.
3. **Test d'abord sur le domaine métier.** La logique de paiement, d'acompte et
   de machine à états s'écrit en test avant implémentation.
4. **La définition de terminé est une commande.** `pnpm test`, `pnpm build`,
   une capture d'écran. Si elle n'est pas vérifiable, elle est mal écrite —
   le signaler plutôt que d'inventer un critère.
5. **Tout écart au blueprint produit un ADR** dans `docs/adr/`. La dérive
   silencieuse est le vrai risque du développement assisté, bien avant la
   qualité du code.
6. **Signaler plutôt que combler.** Face à une ambiguïté ou une information
   manquante — clé d'API, comportement d'agrégateur, règle métier —, s'arrêter
   et poser la question. Ne jamais inventer une valeur plausible.

---

## 7. Interdits

- **Encaisser sur un compte marchand contrôlé par Swap**, même temporairement,
  même « pour dépanner » une vendeuse sans registre de commerce. C'est le seul
  geste qui ferait basculer le produit dans le champ de l'agrément.
- Marquer un paiement « payé » d'après un retour navigateur ou le contenu brut
  d'un webhook.
- Traiter `WAITING_FOR_CUSTOMER` comme un échec.
- Faire du travail métier avant de répondre `200` à un webhook.
- Comparer une signature HMAC avec `==`.
- Ajouter un champ « adresse » de livraison.
- Ajouter une police téléchargée à la boutique publique.
- Ajouter une dépendance de plus de 10 Ko compressés au chemin critique de la
  boutique sans ADR.
- Bloquer le collage dans un champ OTP.
- Utiliser un flottant pour un montant.
- Écrire un secret dans le dépôt, y compris dans un test ou un commentaire.
- Mettre à jour une version majeure de la stack sans ADR.

---

## 8. Ce qui est hors périmètre pour l'instant

Reporté par décision explicite, à ne pas implémenter spontanément :
notifications multicanal (SMS vendeuse, matrice de destinataires, surveillance
de latence), mode USSD, accompagnement à la formalisation RCCM et NIU,
financement de stock. La phase 2 implémente uniquement de quoi **connaître de
façon fiable** le statut d'un paiement et l'afficher dans l'application.

Note : l'accompagnement à la formalisation est reporté comme *fonctionnalité*,
mais la question « comment la vendeuse devient-elle bénéficiaire en son propre
nom » doit être tranchée avec l'agrégateur **avant** d'écrire le lot 8. C'est
une question d'onboarding commercial, pas un blocage juridique.
