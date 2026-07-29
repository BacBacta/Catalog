# PROMPTS.md — implémentation par agent, lot par lot

Seize lots, du dépôt actuel à la production. **Un lot par session.**
Chaque prompt est autonome : il peut être collé tel quel dans une session neuve.

> **Révision du 29/07/2026.** L'architecture v1 se passe d'agrégateur
> (ADR 0009). Les anciens lots 7, 8 et 9 — domaine de paiement piloté par un
> tiers, adaptateur d'agrégateur, webhook — sont **supprimés** et remplacés par
> quatre lots : domaine de la preuve, analyseurs de SMS, rampe de paiement, reçu
> vérifiable. Si tu as en mémoire une version parlant de webhook HMAC ou de
> `WAITING_FOR_CUSTOMER`, elle est périmée.

| Ancien | Nouveau |
|---|---|
| Lot 7 — domaine paiement piloté par agrégateur | **Lot 7** — domaine commande et preuve, sans réseau |
| Lot 8 — adaptateur d'agrégateur et webhook | **Lot 8** — analyseurs de SMS et sept contrôles |
| Lot 9 — parcours de paiement et reçu | **Lot 9** — rampe de paiement · **Lot 10** — reçu vérifiable |
| Lots 10 à 14 | Lots 11 à 15, inchangés sur le fond |
| — | **Lot 0** — bascule d'architecture, à faire en premier |

---

## Préambule — à répéter à chaque session

```
Tu implémentes Catalog : un outil de vente WhatsApp-first pour les commerçantes
camerounaises. Le produit s'appelait Swap avant le 29/07/2026 — si tu croises ce
nom quelque part dans le dépôt, c'est un reste à corriger, pas une autre chose. Avant toute chose, lis AGENTS.md à la racine du dépôt et les ADR
dans docs/adr/, en particulier le 0009. Leurs contraintes priment sur toute
habitude ou tutoriel.

Quatre rappels qui reviennent le plus souvent :
- les montants sont des ENTIERS en XAF (le FCFA n'a pas de sous-unité) ;
- il n'existe pas d'adresse postale au Cameroun : quartier + point de repère
  + téléphone ;
- Catalog n'encaisse jamais et ne prélève aucune commission — le paiement va du
  portefeuille de l'acheteuse à celui de la vendeuse, en direct ;
- la boutique publique a un budget de 30 Ko de JS que la CI fait respecter.

Si le lot touche aux SMS opérateurs, lis AUSSI docs/formats-sms-operateurs.md
en entier. Les expressions régulières y sont écrites contre des messages réels
et vérifiées contre eux : elles se copient, elles ne se réécrivent pas.

Travaille uniquement sur le lot demandé. N'anticipe pas les lots suivants.
Face à une ambiguïté ou une information manquante, arrête-toi et pose la
question plutôt que d'inventer une valeur plausible. Tout écart au blueprint
doit produire un ADR dans docs/adr/.
```

---

# LOT 0 — Bascule d'architecture

À exécuter **avant tout le reste**, sur le dépôt existant.

```
Le projet abandonne l'agrégateur de paiement pour la v1. Applique cette bascule
au dépôt. Aucune fonctionnalité nouvelle dans ce lot : uniquement mettre le
dépôt en accord avec la décision.

1. Documents — ils sont DÉJÀ dans l'arbre de travail, non committés
   Vérifie leur présence, ne les réécris pas : AGENTS.md (révision du
   29/07/2026), PROMPTS.md, docs/formats-sms-operateurs.md,
   docs/adr/0009-v1-sans-agregateur.md, docs/adr/0010-renommage-catalog.md,
   docs/terrain/rampe-paiement.html. Si l'un manque, ARRÊTE-TOI et dis lequel.
   - CLAUDE.md importe déjà @AGENTS.md : ne le modifie pas.
   - N'édite JAMAIS un ADR existant : un ADR ne se réécrit pas, il se remplace.
     Seule exception, une ligne à ajouter en tête des ADR 0007 et 0008 S'ILS
     EXISTENT : « Superseded pour la v1 par l'ADR 0009. » Rien d'autre. S'ils
     n'existent pas, ne les crée pas et signale-le.

2. Mise en dormance de l'adaptateur CamPay
   - src/adapters/campay.ts et ses tests RESTENT. Ils ne sont ni supprimés ni
     déplacés hors du périmètre de la CI : c'est ce qui garantit qu'ils seront
     encore compilables le jour où on les réveille.
   - Ajoute en tête du fichier un bloc de commentaire renvoyant à l'ADR 0009 et
     disant en une phrase pourquoi il dort.
   - Introduis un drapeau PAYMENT_AGGREGATOR_ENABLED, ABSENT par défaut. Sa
     lecture doit lever une erreur explicite si NODE_ENV === "production".
   - Vérifie par une recherche dans le dépôt qu'aucune route, aucun job et aucun
     écran ne l'importe. Si un import existe, coupe-le.
   - Ajoute un test qui échoue si un fichier de src/routes ou src/jobs importe
     l'adaptateur. Ce test est le garde-fou du lot.

3. Renommage Swap → Catalog (ADR 0010)
   Le produit s'appelait Swap. Lis l'ADR 0010 avant de toucher quoi que ce soit :
   il contient la liste exacte de ce qui se renomme, et surtout ce qui NE se
   renomme pas.

   Le piège, et c'est le seul : le mot « catalogue » désigne AUSSI le nom commun
   — la liste d'articles d'une vendeuse — et il est déjà partout dans le code et
   dans la prose. Un identifiant nommé `catalog`, `catalogItem` ou `rCat()`
   porte le NOM COMMUN et ne change pas. Ne renomme QUE ce qui portait `swap`.

   À renommer :
   - portée des paquets @swap/* → @catalog/*, dans les package.json ET dans
     tous les imports ;
   - name du paquet racine, README.md, CLAUDE.md, docker-compose.yml,
     CODEOWNERS, workflows CI ;
   - titres de pages, textes d'interface, <title>, manifeste PWA ;
   - domaine de démonstration swap.cm → catalog.cm ;
   - préfixe des références de commande SW- → CT-, seeds et fixtures compris.

   À NE PAS toucher : les ADR 0001 à 0008, y compris le nom de fichier
   0006-swap-nencaisse-jamais.md. Un ADR ne se réécrit pas — l'ADR 0010 est le
   pont qui explique l'ancien nom.

4. Hygiène
   - Vérifie qu'aucun secret ne figure dans un fichier versionné : parcours
     l'historique récent à la recherche de jetons, de clés webhook et de fichiers
     .env committés. Si tu en trouves un, ARRÊTE-TOI et signale-le sans le
     recopier dans ta réponse.
   - Assure-toi que .env et *.log sont bien ignorés.

Définition de terminé :
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` passe intégralement ;
- le nouveau test de garde échoue si on rétablit volontairement un import de
  l'adaptateur (le prouver, puis annuler) ;
- `git grep -ni "swap" -- apps packages` ne renvoie plus rien. Si une occurrence
  subsiste, elle est soit un oubli, soit un mot anglais légitime (« swap » au
  sens d'échange, dans une dépendance) : tranche et dis lequel ;
- `git grep -n "WAITING_FOR_CUSTOMER\|webhook" -- apps packages` ne renvoie plus
  que des occurrences situées dans l'adaptateur dormant et ses tests. La commande
  est volontairement restreinte à `apps` et `packages` : la documentation, elle,
  DOIT continuer à mentionner ces mots pour signaler qu'ils sont périmés ;
- un commit unique couvrant les documents déposés et ta bascule, message :
  « refactor: bascule v1 sans agrégateur (ADR 0009) ».
```

---

# PHASE 1 — Fondations

## Lot 1 — Squelette du dépôt et chaîne de qualité

*Déjà livré sur la branche existante. Conservé ici pour mémoire et pour
reconstruire depuis zéro si nécessaire.*

```
Crée le squelette du monorepo Catalog. Aucune fonctionnalité produit : uniquement
la structure, l'outillage et une CI qui fonctionne à vide.

À produire :
- Workspace pnpm 11 (pas de Turborepo pour l'instant), avec les paquets
  apps/shop (Astro 7), apps/seller (React Router 8, SPA), apps/api (Hono 4),
  packages/{contracts,db,ui,config}.
- TypeScript 6.x en mode strict, tsconfig.base.json partagé.
  N'utilise PAS TypeScript 7 : il ne supporte pas encore Astro.
- Biome 2.5 pour le lint et le format, configuration unique à la racine.
  Pas d'ESLint, pas de Prettier.
- Vitest 4.1 et Playwright 1.62 câblés, avec un test trivial qui passe dans
  chaque paquet.
- docker-compose.yml : PostgreSQL 18 et MinIO pour le développement local.
- .github/workflows/ci.yml : install (avec cache pnpm) → typecheck → biome
  → vitest → build. Le workflow doit passer au vert sur un dépôt vide.
- README.md : prérequis, démarrage en trois commandes, structure.
- docs/adr/0001 à 0004 rédigés.

N'utilise PAS size-limit pour le budget de la boutique : il échoue quand un glob
ne correspond à rien, or zéro JS est le résultat VOULU. Écris
apps/shop/scripts/budget.mjs, qui compte aussi le contenu des <script> en ligne.

Définition de terminé :
- `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  passe intégralement en local ;
- `docker compose up -d` démarre Postgres 18 et MinIO ;
- le workflow CI est vert sur une pull request de test ;
- le budget échoue quand on injecte volontairement 120 Ko de JS (le prouver).
```

## Lot 2 — Jetons de design et primitives UI

```
Construis packages/ui : le design system de Catalog. Pas d'écran produit ici,
uniquement le socle et une page de démonstration des composants.

Contexte de design : « premium » signifie ici rapide, lisible en plein soleil,
et clair sur les montants — pas riche en animations.

À produire :
- Tailwind 4.3 en configuration CSS-first via @theme. Pas de tailwind.config.js.
- Jetons : rampe de marque verte à une seule teinte (50/200/500/700), statuts
  réservés (good/warn/danger, jamais réutilisés comme couleurs de série),
  échelle typographique, rayons, durées et courbes de mouvement.
- Pile de police système uniquement. Aucune police téléchargée.
- Mode sombre CONÇU : chaque couleur sombre est choisie pour sa surface, jamais
  obtenue par inversion. Gère à la fois prefers-color-scheme et un attribut
  data-theme, la préférence explicite devant l'emporter dans les deux sens.
- Primitives via shadcn CLI 4.16 sur Base UI 1.6 : Button, Input, Select,
  Dialog, Sheet, Toast, Card, Badge, Skeleton, Tabs.
- Composants métier : MoneyDisplay (entier XAF, séparateur milliers insécable,
  chiffres proportionnels en grand / tabulaires en colonne), StatusBadge,
  StatTile, EmptyState, ErrorState, OfflineState.
- Deux composants propres à ce produit, à concevoir ici :
  · SmsPasteField — grande zone de collage, monospace, hauteur généreuse, avec
    un bouton « coller » explicite. Le collage n'est jamais bloqué.
  · ProofChecklist — liste de contrôles à quatre états visuels : réussi, échoué,
    avertissement, en attente. Chaque ligne porte un titre court et une
    explication en langue simple.
- Une page de démonstration listant tous les composants dans leurs quatre états :
  chargement, vide, erreur, hors ligne.

Contraintes :
- cibles tactiles ≥ 44 px ;
- prefers-reduced-motion respecté partout ;
- contraste WCAG 2.2 AA vérifié sur les deux thèmes ;
- aucun composant n'importe Motion : les transitions sont en CSS.

Définition de terminé :
- la page de démonstration s'affiche en clair et en sombre ;
- axe-core ne remonte aucune violation bloquante sur cette page ;
- le poids JS de la page de démonstration est mesuré et noté dans le README.
```

---

# PHASE 2 — Boutique et articles

## Lot 3 — Schéma de données et migrations

```
Écris le schéma Prisma 7 complet et la première migration.

Tables : seller, product, order, payment_proof, order_event, review,
ledger_entry, product_view.

Il n'y a PAS de table payment_event ni de champ provider_tx_id : Catalog n'encaisse
pas et ne reçoit aucun webhook. Ce que le système enregistre, c'est une PREUVE
apportée par la vendeuse, pas une transaction qu'il aurait opérée.

Points sur lesquels tu ne peux pas dévier :
- tous les montants en Int, suffixés _xaf ;
- order.delivery est un jsonb { mode, city, quartier, landmark, phone, geo? } ;
  il n'y a PAS de champ address ;
- payment_proof porte, avec EXACTEMENT ces noms et ces valeurs — ils viennent de
  docs/formats-sms-operateurs.md §4 et toute divergence casse la transposition
  du lot 8 :
    order_id, operator ('mtn' | 'orange' — c'est le champ operatorKey du motif,
    JAMAIS le libellé d'affichage « MTN MoMo »), operator_tx_id (stocké en
    MAJUSCULES), amount_xaf (Int), counterparty_phone (nullable, 9 chiffres),
    counterparty_name (nullable), occurred_at (nullable — un identifiant Orange
    qui s'auto-invalide ne donne pas de date), pattern_id,
    pattern_a_confirmer (bool, MÊME NOM ET MÊME POLARITÉ que le drapeau
    aConfirmer du motif — ne l'inverse pas en « confirmed », c'est le piège),
    raw_sms (texte, chiffré au repos), checks (jsonb), verdict,
    countersigned_at (nullable) ;
- payment_proof n'a AUCUNE colonne de solde. Le solde du compte de la vendeuse
  apparaît dans les SMS et ne doit être ni persisté, ni journalisé, ni tracé ;
- UNIQUE(operator, operator_tx_id) sur payment_proof — c'est le contrôle n° 5,
  et il est RÉSEAU-LARGE : un identifiant d'opérateur ne vaut qu'une fois chez
  TOUTES les vendeuses, pas une fois par commande. Cette contrainte vit en base,
  pas dans un if applicatif ;
- contrainte CHECK : amount_paid_xaf + balance_xaf = total_xaf sur order ;
- déclencheur interdisant UPDATE et DELETE sur ledger_entry et sur payment_proof
  — une preuve ne se corrige pas, elle se remplace par une autre ;
- order.verification_code UNIQUE, format XXXX-XXXX sur un alphabet sans
  caractères ambigus (ni O/0, ni I/1/l, ni B/8). Attention au piège : si la
  taille de l'alphabet partage un facteur avec le pas de génération, tu produis
  des codes du type TTTT-TTTT. Utilise un générateur congruentiel linéaire et
  écris un test sur 10 000 codes qui vérifie l'absence de répétition de motif.

Ajoute aussi :
- les schémas Zod correspondants dans packages/contracts, source de vérité des
  types partagés entre API et frontends ;
- un seed de développement : 3 vendeuses, 18 articles, 12 commandes. Les
  vocabulaires viennent des lots 7 et 11 ; comme ils n'existent pas encore,
  FIGE-LES ICI et ne les redéfinis pas plus tard :
    · modes de paiement : 'integral' | 'acompte' | 'sans_prepaiement'
    · état de la preuve : 'attendu' | 'declare_non_trace' | 'prouve'
                        | 'contresigne' | 'conteste'
    · étape de la commande : 'recue' | 'preparee' | 'chez_le_livreur' | 'livree'
  Couvre les trois modes, et au minimum : 3 preuves validées, 2 paiements non
  tracés, 1 contestation, 1 commande à chaque étape ;
- les index nécessaires aux requêtes de liste.

Définition de terminé :
- `pnpm db:migrate && pnpm db:seed` fonctionne sur une base vide ;
- un test prouve que la contrainte UNIQUE rejette le même operator_tx_id soumis
  par DEUX VENDEUSES DIFFÉRENTES ;
- un test prouve que UPDATE sur ledger_entry et sur payment_proof échoue ;
- un test prouve que la contrainte CHECK rejette une commande incohérente ;
- un test sur 10 000 codes de vérification prouve l'absence de motif dégénéré.
```

## Lot 4 — Authentification par téléphone

```
Implémente l'authentification vendeuse avec Better Auth 1.6 et son plugin
phoneNumber.

Il n'y a PAS d'authentification par e-mail dans ce produit : les commerçantes
camerounaises s'identifient par numéro de téléphone.

À produire :
- Better Auth branché sur Postgres via Prisma, plugin phoneNumber activé.
- Le fournisseur SMS est une INTERFACE dans src/domain, avec deux
  implémentations : une factice qui écrit le code dans les logs en
  développement, et un adaptateur vide prêt pour un fournisseur camerounais.
  Ne code en dur aucun fournisseur.
- Normalisation des numéros au format E.164 (+237…), en acceptant les saisies
  courantes : « 6 77 12 34 56 », « 677123456 », « 237677123456 », « +237 677 12 34 56 ».
  Une fonction normalizePhone existe déjà dans packages/contracts : réutilise-la,
  ne la réécris pas.
- Le NUMÉRO DE REVERSEMENT est un champ DISTINCT du numéro de connexion, vérifié
  par son propre OTP. La double SIM est la norme : une vendeuse se connecte avec
  sa puce MTN et se fait payer sur son Orange Money. Toute modification de ce
  numéro exige une nouvelle vérification — c'est le champ qu'un attaquant
  chercherait à détourner. Journalise chaque changement.
- Limitation de débit : par numéro, par IP, et plafond journalier. Un SMS coûte
  de l'argent — une boucle d'envoi non bridée est à la fois une faille et une
  facture.
- Écrans dans apps/seller : saisie du numéro, saisie de l'OTP, session, réglage
  du numéro de reversement.

Accessibilité, non négociable : le champ OTP DOIT accepter le collage et
l'auto-remplissage SMS (autocomplete="one-time-code"). Bloquer le collage est
une régression au sens du critère WCAG 2.2 3.3.8, pas une mesure de sécurité.

Définition de terminé :
- un test Playwright couvre le parcours complet avec le fournisseur factice ;
- un test prouve que la limitation de débit bloque à la quatrième demande ;
- un test prouve qu'un changement de numéro de reversement sans OTP est rejeté
  et journalisé ;
- le collage fonctionne dans le champ OTP (couvert par le test e2e).
```

## Lot 5 — Articles et chaîne d'images

```
Implémente la gestion du catalogue côté vendeuse : création, modification,
archivage, réordonnancement.

Chaîne d'images — c'est le cœur du lot :
- redimensionnement CÔTÉ CLIENT avant envoi, plus grand côté à 640 px, JPEG
  qualité 0,75, via canvas ;
- affichage à la vendeuse du gain obtenu (« 701 Ko → 80 Ko »), qui n'est pas
  un gadget : c'est son forfait data ;
- revalidation et re-encodage côté serveur en AVIF avec repli WebP, jamais de
  confiance au client ;
- stockage S3/R2, clés opaques, URLs signées.

Formulaire réduit au strict minimum : photo, nom, prix. Rien d'autre en
obligatoire — chaque champ supplémentaire est une vendeuse perdue.

Définition de terminé :
- un test e2e téléverse une image de 2 Mo et vérifie que l'objet stocké fait
  moins de 100 Ko ;
- un test vérifie que le serveur rejette un fichier non-image et un fichier
  au-delà de la taille maximale ;
- l'API de liste des articles répond en moins de 100 ms sur le seed.
```

## Lot 6 — Boutique publique Astro

```
Construis apps/shop : la boutique publique. C'est la surface la plus critique
du produit en termes de performance — elle est ouverte par des acheteuses sur
des réseaux mobiles saturés, et elle doit être servie depuis le CDN.

Pages :
- /[slug] — boutique : identité, badge vérifié, note, grille d'articles ;
- /[slug]/[product] — fiche article, variantes, quantité ;
- bouton « Commander sur WhatsApp » qui génère un lien wa.me pré-rempli.

Le message pré-rempli doit être AUTOSUFFISANT en texte brut. Contenu obligatoire,
identique à celui d'AGENTS.md — n'en ajoute ni n'en retire :
article, quantité, prix unitaire, total, et le nom de la boutique. La référence
et le code de vérification n'existent qu'une fois la commande créée : ils
rejoignent le message au lot 11, pas ici. Le lien n'est jamais le seul porteur
d'information — certains acheteurs sont sur un forfait où les liens externes
peuvent échouer.

Contraintes de performance, appliquées par la CI :
- ≤ 30 Ko de JS compressés sur le chemin critique, budget.mjs faisant foi ;
- ≤ 120 Ko de poids total en première visite ;
- LCP < 2,5 s en profil Slow 4G bridé ;
- aucune police téléchargée ;
- îlots Astro (client:visible) uniquement là où il y a réellement de
  l'interactivité — le sélecteur de variante et le compteur de quantité ;
- dimensions explicites sur toutes les images (CLS < 0,1).

Ajoute Lighthouse CI sur profil mobile bas de gamme avec seuils durs.

Définition de terminé :
- les budgets sont dans la CI et un dépassement délibéré fait échouer le build
  (le prouver par une pull request de test) ;
- Lighthouse mobile : performance ≥ 95, accessibilité = 100 ;
- le lien wa.me généré est couvert par un test unitaire, encodage compris.
```

---

# PHASE 3 — Preuve et paiement

C'est le cœur du produit. Quatre lots, aucun appel réseau vers un tiers de
paiement dans aucun d'eux.

## Lot 7 — Domaine commande et preuve, sans réseau

```
Implémente la logique métier dans apps/api/src/domain, SANS aucun appel réseau
ni accès base. Test-first : les tests s'écrivent avant le code.

À modéliser :

1. Modes de paiement — intégral, acompte, sans prépaiement.
   L'acompte est déjà implémenté dans packages/contracts/src/money.ts
   (splitDeposit). RÉUTILISE-LE. 50 % de 7 501 donne 3 750 d'acompte et 3 751 de
   solde : c'est la règle floor-sur-l'acompte, elle est couverte par un test de
   propriété, ne la « corrige » pas.

2. Machine à états de la PREUVE, pas du paiement — Catalog n'opère aucun paiement,
   il constate :
     attendu → déclaré_non_trace       (la vendeuse dit avoir reçu, sans SMS)
     attendu → prouve                  (SMS analysé, contrôles passés)
     prouve  → contresigne             (l'acheteuse a tapé « oui, c'est moi »)
     tout état → conteste
   Règles :
   - un état ne RECULE JAMAIS ; toute transition arrière est journalisée puis
     ignorée ;
   - déclaré_non_trace n'ouvre droit ni à un reçu, ni à un avis vérifié ;
   - contresigne est le seul état à deux voix, et c'est le plus fort.

3. Expiration : une commande non payée expire à 48 h, avec rappel à 2 h et 24 h.
   Le temps courant est un PARAMÈTRE, jamais Date.now() lu dans le domaine —
   sinon les tests deviennent non déterministes.

4. Montants non conformes : le sous-paiement et le sur-paiement produisent un
   état partiel documenté, jamais un rejet silencieux.

Ce lot ne contient AUCUN analyseur de SMS et AUCUNE construction de chaîne
USSD : ce sont les lots 8 et 9. Il définit seulement les types et les
transitions qu'ils alimenteront.

Définition de terminé :
- couverture ≥ 90 % sur src/domain ;
- un test par transition d'état, y compris chacune des transitions interdites ;
- un test prouve qu'une transition arrière est journalisée ET ignorée ;
- un test prouve que le prédicat canIssueReceipt(etat) est faux pour
  declare_non_trace et vrai pour prouve et contresigne. Le reçu lui-même est
  produit au lot 10 : ici on ne teste que le prédicat ;
- un test parcourt les fichiers de src/domain et échoue s'il y trouve
  `from "@prisma`, `from "hono`, `fetch(` ou `Date.now(`. Un test, pas une règle
  de lint : Biome 2.5 ne sait pas exprimer cette contrainte sans plugin.
```

## Lot 8 — Analyseurs de SMS et sept contrôles

```
LIS docs/formats-sms-operateurs.md EN ENTIER AVANT D'ÉCRIRE UNE LIGNE.
Ce fichier est une spécification, pas de la documentation. Les expressions
régulières qu'il contient ont été écrites contre des messages réels et vérifiées
contre eux. Tu les TRANSPOSES en TypeScript strict, tu ne les réinventes pas.
Un motif écrit de mémoire se casse sur l'espace avant la parenthèse fermante,
sur le numéro à douze chiffres, ou sur l'anglais.

À produire dans apps/api/src/domain/proof :

1. Les outils : local9, xafInt, normalizeSms, decodeOrangeId, OM_ID.
   decodeOrangeId renvoie null sur un identifiant non-Orange : c'est ainsi que
   le contrôle n° 6 DISPARAÎT chez MTN au lieu d'échouer.

2. Les cinq motifs de la section 4 de la spec, dans l'ordre donné. L'ordre
   compte : la réception MTN doit passer avant le transfert. Verrouille-le par
   un test, sinon un refactor le détruira sans bruit.
   Le motif om.entrant porte aConfirmer: true. Ce drapeau n'est pas un
   commentaire : il fait passer le contrôle n° 1 en avertissement et plafonne le
   verdict à « accepté sous réserve ». Il ne se promeut jamais sans une capture
   complète.

3. Les sept contrôles, exactement selon la section 5 de la spec. Trois points
   dont dépend la justesse du produit :
   - le contrôle 3 dépend du SENS du message. Le SMS d'émission nomme le
     destinataire, celui de réception nomme l'expéditeur. Les comparer au même
     numéro de référence rejetterait TOUS les paiements légitimes ;
   - un numéro qui ne correspond pas est un AVERTISSEMENT, jamais un refus :
     la double SIM et le paiement par un proche sont la norme au Cameroun ;
   - le contrôle 5 est réseau-large et s'appuie sur la contrainte UNIQUE en base
     du lot 3, pas sur une requête suivie d'un if — cette course se perd.

4. L'écran vendeuse « coller le SMS » dans apps/seller, avec SmsPasteField et
   ProofChecklist du lot 2. Chaque contrôle affiche une explication en langue
   simple : la vendeuse doit comprendre POURQUOI un paiement est refusé, sinon
   elle expédie quand même.

5. Un bandeau permanent au-dessus du champ : « Ne vous fiez jamais à une capture
   d'écran. Seul votre propre SMS compte. » Une capture ne porte aucun
   identifiant contrôlable ; si l'interface en accepte une, c'est en pièce
   jointe illustrative, jamais en entrée de contrôle.

Le SMS brut est chiffré au repos. Il contient le solde du compte de la vendeuse :
il ne doit apparaître ni dans un log, ni dans une trace, ni dans un message
d'erreur.

Définition de terminé :
- toutes les fixtures de la section 6 de la spec passent, y compris les deux cas
  qui doivent ÉCHOUER à être reconnus (message tronqué, texte libre) ;
- un test prouve que le même identifiant soumis par deux vendeuses différentes
  est refusé par la base ;
- un test prouve qu'un motif aConfirmer ne peut pas produire le verdict
  « accepté » ;
- un test de propriété prouve que tout montant sorti d'un analyseur satisfait
  Number.isInteger ;
- un test prouve que le SMS brut n'apparaît dans aucun log ;
- axe-core sans violation sur l'écran de collage.
```

## Lot 9 — Rampe de paiement

```
Implémente la rampe : Catalog ne déclenche aucun transfert, il PRÉ-REMPLIT le
clavier de l'acheteuse.

Mécanique :
- un lien tel: portant la chaîne USSD, avec le # encodé %23. Le composeur
  s'ouvre garni ; l'acheteuse appuie sur appeler. Pas d'application à installer,
  pas de permission à accorder.
- LE CODE D'ENTRÉE N'EST JAMAIS UNE CONSTANTE EN DUR. *126# chez MTN,
  #150*50# chez Orange. Il vit dans une configuration par opérateur, modifiable
  sans redéploiement : les opérateurs les changent.
- Chaque entrée de configuration porte un drapeau verifie: true|false.
  Les codes d'entrée sont verifie: true. Toute chaîne complète censée sauter les
  niveaux de menu est verifie: false tant que personne ne l'a testée sur un
  téléphone réel à Douala.
- Quand une chaîne est verifie: false, l'interface propose LES DEUX chemins :
  le raccourci, et le code d'entrée simple avec les étapes écrites en clair
  au-dessous. L'écran doit rester utilisable si le raccourci échoue.

Interdits absolus de ce lot :
- ne JAMAIS demander, afficher, stocker ou pré-remplir le CODE SECRET mobile
  money. Il se saisit dans la session de l'opérateur. Catalog ne le voit pas et
  n'a aucun champ où il pourrait être saisi ;
- ne pas prétendre que le paiement est confirmé après l'appel : la rampe ne
  renvoie rien. La commande passe en « en attente de preuve ».

Écrans côté acheteuse :
1. choix de l'opérateur — MTN MoMo ou Orange Money, avec le numéro de
   reversement de la vendeuse affiché en grand et copiable d'un tap ;
2. le bouton de rampe, et au-dessous les étapes écrites, toujours ;
3. un écran d'attente honnête : « la vendeuse confirmera la réception ». Il
   n'annonce ni succès ni échec, parce que Catalog ne sait pas.

Ajoute au message WhatsApp généré le numéro de reversement et le montant en
texte brut : si le lien échoue, l'acheteuse doit pouvoir payer quand même.

Définition de terminé :
- un test unitaire couvre la construction de la chaîne pour chaque opérateur,
  encodage du # compris, et prouve qu'aucun code n'est écrit en dur hors de la
  configuration ;
- un test prouve qu'une entrée verifie: false affiche les deux chemins ;
- un test parcourt apps/shop et apps/seller et échoue s'il y trouve un champ de
  saisie, une clé d'état ou un libellé correspondant à
  /\b(pin|code[_ -]?secret|secret[_ -]?code|mot de passe momo)\b/i.
  Le motif est ancré sur des mots entiers exprès : « spinner » et « mapping » ne
  doivent pas le déclencher. Les fichiers de documentation sont exclus ;
- l'écran d'attente n'affiche jamais « paiement confirmé ».
```

## Lot 10 — Reçu vérifiable et contre-signature

```
Implémente la preuve publiable — la valeur numéro un du produit.

1. Le reçu. Quand une preuve passe les contrôles, Catalog émet un reçu portant
   L'IDENTIFIANT DE TRANSACTION DE L'OPÉRATEUR, le montant, la référence de
   commande, l'opérateur et la date. Le reçu dit explicitement comment le
   vérifier : en agence, ou par le code de consultation de l'opérateur — LU DANS
   LA CONFIGURATION DU LOT 9, jamais figé dans un gabarit de reçu. Les opérateurs
   changent leurs codes ; un reçu qui en fige un envoie l'acheteuse sur un code
   faux, et c'est l'interdit « figer un code USSD en constante » d'AGENTS.md.

   Catalog n'atteste rien de lui-même. Il rend la vérification POSSIBLE par
   n'importe qui. C'est la phrase à relire si une décision de conception hésite.

2. /v/[code] dans apps/shop — page publique de vérification, consultable sans
   compte, sous le budget de 30 Ko de JS. Elle affiche le reçu, l'identifiant,
   l'état de la contre-signature, et la marche à suivre pour contrôler auprès de
   l'opérateur. Un code inexistant produit un refus explicite, jamais une page
   vide.

3. La contre-signature. Elle vit sur /suivi/[ref] — que CE lot crée, dans sa
   version minimale : référence, montant, reçu, contre-signature. Le lot 11 y
   ajoutera les étapes de livraison. Ne construis pas le cycle de vie ici,
   seulement la coquille qui porte le reçu.
   L'acheteuse voit le reçu et confirme d'un seul tap. Deux parties indépendantes se
   retrouvent alors sur le même identifiant : falsifier exigerait la complicité
   de quelqu'un qui n'a rien à y gagner, pour une vraie transaction avec ses
   frais, contre une étoile.
   - un tap, pas un formulaire ;
   - pas de compte requis, le lien de suivi fait autorité ;
   - l'acheteuse peut aussi CONTESTER, ce qui bascule la preuve en conteste et
     n'efface rien.

4. Côté vendeuse, un écran « vérifier un reçu » : coller un code ou un
   identifiant, obtenir « preuve authentique » avec le détail, ou « aucune
   preuve ne correspond » avec la consigne de ne rien expédier.

Dis la vérité dans l'interface : ce n'est pas une preuve cryptographique.
C'est un identifiant que l'opérateur peut confirmer, apporté par la personne
dont l'argent est en jeu, et contresigné par l'autre partie. Ne jamais écrire
« garanti » ni « certifié ».

Définition de terminé :
- test e2e du parcours complet : commande, rampe, collage du SMS, reçu,
  contre-signature ;
- un test prouve qu'un code inexistant produit le refus explicite ;
- un test prouve qu'un paiement déclaré_non_trace n'a pas de page /v/ ;
- un test prouve qu'une contestation ne supprime pas la preuve ;
- la page /v/ est sous le budget de 30 Ko ;
- axe-core sans violation sur les quatre écrans.
```

---

# PHASE 4 — Commandes et réputation

## Lot 11 — Cycle de vie des commandes

```
Implémente le cycle de vie complet : reçue → préparée → confiée au livreur →
livrée, avec encaissement du solde d'acompte à la remise.

Côté vendeuse : liste des commandes, avancement du statut, tuile « soldes à
encaisser » sur le tableau de bord. L'avancement de statut utilise une
interface optimiste avec retour arrière visible en cas d'échec — mais jamais
d'optimisme sur un mouvement d'argent.

Côté acheteuse : ENRICHIS la page /suivi/[ref] créée au lot 10 — n'en crée pas
une seconde. Elle porte déjà le reçu et la contre-signature ; tu y ajoutes les
étapes de livraison. Le libellé de l'étape de livraison doit refléter la réalité
du terrain : le livreur appelle en arrivant dans le quartier, il ne trouve pas
une adresse.

Complète aussi le message WhatsApp du lot 6 : la référence de commande et le
code de vérification n'existaient pas encore à ce stade, ils existent maintenant.

L'action « déclarer un paiement reçu » existe pour le dépôt direct non prouvé.
Elle fait avancer la commande et marque le paiement NON TRACÉ. On ne cherche pas
à bloquer ce cas : la vendeuse le ferait de toute façon hors du système, et on
perdrait aussi la donnée. Mais l'écart doit être visible : à côté du bouton,
proposer « j'ai le SMS » qui mène au collage.

Définition de terminé :
- test e2e du cycle complet en mode acompte, solde encaissé compris ;
- un test prouve qu'un paiement déclaré manuellement n'ouvre pas droit à un
  avis vérifié ;
- la page de suivi est sous le budget de 30 Ko de JS.
```

## Lot 12 — Avis vérifiés

```
Implémente la réputation. C'est l'actif de verrouillage du produit : une
réputation n'est pas portable ailleurs.

Règles :
- un avis n'est possible qu'après une commande livrée ;
- il porte le label « achat vérifié » UNIQUEMENT si le paiement est à l'état
  prouve ou contresigne. Un paiement déclaré_non_trace ne l'ouvre pas ;
- un avis non vérifié est publié mais n'entre pas dans le calcul de la note ;
- un avis par commande, contrainte UNIQUE sur order_id ;
- la note et le nombre de ventes vérifiées s'affichent sur la boutique publique
  sous l'identité de la vendeuse — c'est l'endroit exact où une acheteuse
  inconnue décide de faire confiance.

Définition de terminé :
- un test prouve qu'un paiement non tracé produit un avis non vérifié qui ne
  modifie pas la note ;
- un test prouve qu'un deuxième avis sur la même commande est rejeté ;
- le badge de réputation sur la boutique publique n'ajoute aucun JS.
```

## Lot 13 — Statistiques vendeuse

```
Implémente l'écran statistiques : vues par jour, entonnoir, articles les plus
vus, sources de trafic, et la part des ventes prouvées.

Avant d'écrire la moindre ligne de graphique, applique la méthode de
visualisation du projet : une seule teinte pour une série unique, emphase sur
le point qui porte l'histoire et gris de recul pour le reste, grille en filet
plein (jamais pointillée), étiquettes sélectives et non sur chaque point,
légende dès deux séries, et une vue tableau accessible en regard de chaque
graphique.

Les graphiques sont en SVG produit côté serveur ou en CSS. AUCUNE bibliothèque
de graphiques : elles pèsent toutes plus que le budget entier de la page.

L'indicateur « part des ventes prouvées » est le plus important du produit —
c'est la mesure du contournement, donc du modèle lui-même. Il doit être visible
et compréhensible sans explication. Décompose-le en trois : prouvé,
contresigné, non tracé.

Définition de terminé :
- chaque graphique a une vue tableau consultable ;
- aucune bibliothèque de graphiques dans les dépendances ;
- l'écran respecte le budget JS ;
- axe-core sans violation, y compris sur les vues tableau.
```

---

# PHASE 5 — Production

## Lot 14 — Observabilité et runbooks

```
Instrumente l'application pour la production.

- OpenTelemetry : traces sur les parcours critiques — création de commande,
  ouverture de la rampe, soumission de preuve, contre-signature —, métriques et
  logs structurés corrélés. Le SMS brut ne figure dans AUCUNE trace.
- Tableaux de bord et alertes :
  · taux de preuves refusées par contrôle et par opérateur — une bascule
    soudaine sur le contrôle n° 1 signale un CHANGEMENT DE FORMAT chez
    l'opérateur, et c'est la panne la plus probable de ce produit ;
  · part des commandes en déclaré_non_trace, en fenêtre glissante ;
  · délai médian entre commande et preuve ;
  · tentatives de réutilisation d'un identifiant déjà réclamé.
- Un canari sur les formats : un test quotidien rejoue les fixtures de
  docs/formats-sms-operateurs.md. S'il casse, c'est que quelqu'un a touché à un
  motif sans lire la spec.
- Runbooks dans docs/runbooks/ : changement de format de SMS chez un opérateur,
  code USSD modifié, paiement contesté, restauration de sauvegarde. Chacun avec
  les symptômes, le diagnostic, les actions et le critère de sortie.
- Sauvegardes Postgres quotidiennes, et un script de restauration vers un
  environnement neuf.

Définition de terminé — PAR L'AGENT :
- le canari de format tourne en CI quotidienne et échoue si on modifie un motif ;
- les runbooks existent, chacun avec symptômes, diagnostic, actions, critère de
  sortie ;
- le script de restauration existe et sa procédure est écrite ;
- un test prouve que le SMS brut n'apparaît dans aucune trace OpenTelemetry.

Définition de terminé — PAR UN HUMAIN, hors session :
- une restauration effectuée pour de vrai sur un environnement vierge, temps mis
  noté dans le runbook ;
- chaque alerte déclenchée volontairement au moins une fois ;
- objectifs de perte de données maximale et de délai de remise en service écrits.

L'agent livre le premier bloc, liste le second et s'arrête. Il ne bloque pas sur
des critères qu'aucune commande ne peut trancher depuis une session.
```

## Lot 15 — Durcissement et mise en production

```
Prépare le lancement.

- Revue de sécurité : en-têtes HTTP, politique de sécurité de contenu, CORS,
  limitation de débit sur toutes les routes publiques, taille maximale des
  charges utiles, audit des dépendances.
- Revue spécifique de la preuve : tenter de rejouer un identifiant, de soumettre
  un SMS forgé pour chaque motif, de contresigner sans le lien de suivi, de
  faire passer un motif aConfirmer pour confirmé. Chaque tentative doit avoir un
  test qui prouve son échec.
- Test de charge dimensionné sur le pic du 8 mars — le pagne officiel s'écoule
  en moins de deux semaines et c'est le jour où le système doit tenir. Cible :
  trois fois le pic anticipé.
- Vérification des budgets de performance depuis un vrai réseau camerounais,
  pas depuis un simulateur.
- Ouverture progressive par cohortes, avec un interrupteur d'arrêt et une
  procédure de retour arrière testée.
- Page de statut publique.

Définition de terminé — PAR L'AGENT :
- chaque tentative d'attaque sur la preuve a un test qui prouve son échec ;
- en-têtes, CSP, CORS, limitation de débit et tailles maximales sont en place et
  couverts par des tests ;
- `pnpm audit` ne signale aucune vulnérabilité critique ou élevée ;
- le script de test de charge existe et tourne contre un environnement local ;
- la checklist de lancement est écrite dans docs/runbooks/.

Définition de terminé — PAR UN HUMAIN, hors session :
- test de charge passé à trois fois le pic sur l'infrastructure réelle ;
- budgets de performance vérifiés depuis un vrai réseau camerounais ;
- retour arrière déclenché volontairement en préproduction et vérifié ;
- tous les points de la checklist cochés.
```

---

## Comment piloter la séquence

**Un lot par session, sans exception.** Un agent qui reçoit deux lots en livre
deux moitiés.

**Après chaque lot** : vérifier soi-même la définition de terminé — lancer les
commandes, regarder les captures — avant d'ouvrir la session suivante. Un lot
validé sur parole se paie deux lots plus loin.

**Il n'y a plus de porte de phase 0.** L'ancienne séquence attendait la réponse
écrite d'un agrégateur avant d'écrire du code de paiement. Sans agrégateur,
cette dépendance disparaît : la phase 3 peut démarrer dès que la phase 2 est
livrée.

**Les deux inconnues de terrain ne bloquent rien.** Le SMS Orange de réception
et les raccourcis USSD paramétrés se confirment par des captures et un test sur
un téléphone à Douala, en parallèle du développement. Le lot 9 produit lui-même
l'instrument du second test.

**Après la phase 4** : la porte du pilote — 30 % des transactions prouvées dans
le système, et la moitié des vendeuses encore actives en semaine 12 — n'est pas
une formalité. En dessous, ce n'est pas le produit qu'il faut corriger, c'est la
thèse. Les sujets reportés (notifications, formalisation, crédit, réveil de
l'agrégateur) ne se cadrent qu'après.
