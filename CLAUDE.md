# CLAUDE.md

@AGENTS.md

`AGENTS.md` est le contrat de travail : contraintes non négociables, stack
figée, conventions, interdits. Il prime sur toute habitude ou tutoriel.
Ce fichier-ci ne contient que ce qui est propre à une session Claude Code.

## Avant de commencer

Lis `AGENTS.md`, puis les ADR de `docs/adr/` concernés par ta tâche. Ils
expliquent **pourquoi** les choix ont été faits — plusieurs corrigent des
erreurs précédentes, et les refaire coûterait cher.

Les plus structurants :

- `0004` — les montants sont des entiers XAF, jamais de flottant
- `0005` — il n'existe pas d'adresse au Cameroun, jamais de champ `address`
- `0006` — Catalog n'encaisse jamais, les fonds ne touchent aucun compte à nous
- `0009` — **la v1 se passe d'agrégateur** : dépôt direct, preuve par SMS.
  Il remplace l'orientation du `0007` et s'appuie sur les mesures du `0008`.
  C'est celui à lire en premier.
- `0010` — le produit s'appelle **Catalog** ; `catalogue` reste le nom commun

Les ADR `0007` et `0008` restent utiles pour comprendre pourquoi la voie
agrégateur a été abandonnée, mais ils sont dépassés pour la v1.

Le format des SMS opérateurs est une **spécification**, pas de la
documentation : `docs/formats-sms-operateurs.md` se lit en entier avant tout
travail sur la preuve, et ses expressions régulières se copient sans être
réécrites.

## Secrets

Les identifiants vivent dans `.env`, jamais dans un fichier versionné, un
commit, un test ou un commentaire. `.env` est déjà dans `.gitignore`.
Si un secret apparaît dans le dépôt, arrête-toi et signale-le.

## Vérifier son travail

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size
```

Les cinq doivent passer. `pnpm size` fait échouer la boutique publique
au-delà de 30 Ko de JS — c'est une règle de compilation, pas une intention.
Depuis le lot 13 il mesure **deux** paquets : la boutique, et l'écran
statistiques de l'app vendeuse (8 Ko, plafond choisi pour qu'aucune
bibliothèque de graphiques n'y entre).

`pnpm db:sauvegarde` et `pnpm db:restauration` (lot 14) ne sont **pas** dans
cette chaîne : ils demandent une vraie base, et une restauration ne se lance pas
par mégarde.

## Méthode

Un lot à la fois. Test d'abord sur la logique métier. Tout écart au blueprint
produit un ADR dans `docs/adr/`. Face à une ambiguïté ou une information
manquante, arrête-toi et demande plutôt que d'inventer une valeur plausible.

## Tâche en cours

La séquence d'implémentation vit dans `PROMPTS.md` : un lot par session, dans
l'ordre. Faits : lot 0 (bascule v1 sans agrégateur et renommage), lot 2
(jetons de design et primitives), lot 3 (schéma de preuve et contraintes SQL),
lot 4 (authentification par téléphone, numéro de reversement, limitation de
débit, écrans vendeuse), lot 5 (catalogue et chaîne d'images), lot 6 (boutique
publique Astro et Lighthouse CI), lot 7 (domaine commande et preuve, sans réseau),
lot 8 (analyseurs de SMS, sept contrôles, écran de collage), lot 9 (rampe de
paiement), lot 10 (reçu vérifiable et contre-signature), lot 11 (cycle de vie des
commandes), lot 12 (avis vérifiés et réputation), lot 13 (écran statistiques),
lot 14 (observabilité, canari de formats, runbooks, sauvegardes).

Quatre choses à savoir du lot 14, toutes dans l'ADR 0023 :

- **Le SMS brut ne figure dans AUCUNE trace**, et c'est tenu par deux couches :
  une liste FERMÉE d'attributs autorisés, et un processeur de rédaction qui
  nettoie aussi les événements, le message de statut et le nom du span. La fuite
  réelle n'arrive pas par `setAttribute` — elle arrive par `recordException`,
  qui recopie le message ET la pile d'appel.
- **Aucune auto-instrumentation OpenTelemetry.** Elle capturerait les paramètres
  SQL, dont `buyerToken` — le secret qui autorise la contre-signature.
- **Le canari rejoue la SPÉCIFICATION**, pas les fixtures : il lit
  `docs/formats-sms-operateurs.md`, en extrait les messages et les fait passer
  par les analyseurs réels. Il tourne aussi chaque jour en CI, et c'est ce qui
  permet de répondre, un jour d'incident, à « est-ce nous ou l'opérateur ? ».
- **`restauration.sh` refuse d'écrire dans `DATABASE_URL`.** On restaure
  ailleurs, on vérifie — contraintes SQL du lot 3 réappliquées, trois contrôles
  d'intégrité —, puis on bascule.

Quatre choses à savoir du lot 13 avant de toucher à un graphique, toutes dans
l'ADR 0022 :

- **Il n'y a aucune bibliothèque de graphiques, et trois contrôles le
  garantissent** : une liste de paquets refusés dans tous les `package.json`, un
  test qui lit les imports de `packages/ui/src/charts/`, et le plafond de 8 Ko du
  paquet de l'écran. La plus légère des bibliothèques pèse ~10 Ko à elle seule.
- **`Graphique` EXIGE ses colonnes et ses lignes.** On ne peut pas rendre un
  graphique sans sa vue tableau : la règle est tenue par le typage, pas par la
  discipline. Le tableau vit dans un `<details>` et s'ouvre sans JavaScript.
- **Les couleurs sortent d'un validateur de palette**, jamais de l'œil, et
  `tokens.test.ts` re-mesure les écarts de clarté à chaque exécution. Les deux
  rampes s'inversent entre les thèmes : la marche la plus profonde est celle qui
  contraste le plus avec SA surface. « Non tracé » est **gris**, jamais rouge.
- **Deux informations manquantes sont DITES, pas comblées** (AGENTS.md §7.7) :
  les sources de trafic n'existent nulle part, et `product_view` n'est alimentée
  par aucun chemin de code — la boutique statique ne compte pas ses pages vues.
  `stats-instrumentation.test.ts` empêche le drapeau `vuesInstrumentees` de
  mentir dans un sens comme dans l'autre.

Trois choses à savoir du lot 10 avant de toucher au reçu, toutes dans l'ADR 0021 :

- **Deux clés, deux pouvoirs.** `verification_code` identifie et devient public
  dès qu'un reçu est montré ; `buyer_token` autorise la contre-signature, et lui
  seul. Ne jamais faire ouvrir le suivi par la référence ou par le code : il
  suffirait d'avoir vu un reçu pour valider le paiement d'autrui.
- **`payment_proof` est en ajout seul**, donc `countersigned_at` est une colonne
  MORTE : la date de contre-signature vit dans `order_event`. La colonne se
  retire en phase *contract*, pas avant.
- **`/v/?c=<code>` est la forme dont le produit dépend**, pas `/v/<code>`. Une
  sortie statique ne connaît que les chemins énumérés à la construction ; la
  jolie URL n'existe que derrière la réécriture de `public/_redirects`.

Trois choses à savoir du lot 9 avant de toucher au paiement, toutes dans
l'ADR 0020 :

- **`apps/api/src/domain/ramp/config.ts` est le seul fichier du dépôt où un code
  USSD est écrit**, et un test parcourt les quatre arbres de sources pour le
  garantir. Les valeurs y sont un défaut daté ; l'environnement les remplace à
  chaud, sans reconstruire la boutique.
- **Le drapeau `verifie` ne suit pas le gabarit.** Changer une chaîne ne la rend
  pas vérifiée : seul quelqu'un qui l'a composée à Douala pose le drapeau. Tant
  qu'il est `false`, l'écran propose le raccourci **et** le menu manuel.
- **La page `/payer` assume son JavaScript** et lit `GET /api/rampe` à
  l'exécution — c'est ce qui rend un changement de code applicable sans
  redéploiement. Aucun code de repli n'est écrit côté boutique, même hors ligne :
  ce serait la constante que le lot interdit, et elle serait périmée.

Le lot 8 a **amendé `docs/formats-sms-operateurs.md`** sur un point, et c'est le
seul écart autorisé à la règle « on ne réécrit pas les motifs » : `Number("")`
vaut zéro, pas NaN, donc un montant fait uniquement de séparateurs produisait un
paiement de **zéro franc** parfaitement formé. Voir l'ADR 0019. La spec reste la
source : elle a été mise à jour d'abord.

Le lot 7 ajoute une porte : **`pnpm test:coverage` exige 90 % sur `src/domain`**,
et un test refuse `from "@prisma`, `from "hono`, `fetch(`, `Date.now(`,
`new Date()`, `Math.random()`, `node:fs` et `process.env` dans ce répertoire.
Le temps et l'aléa arrivent toujours en paramètre. Voir l'ADR 0018 — il documente
notamment la transition `declare_non_trace → prouve`, absente de la liste
littérale du blueprint : sans elle, une vendeuse qui déclare à la main puis
retrouve son SMS n'aurait jamais de reçu.

Le lot 5 ajoute une règle de compilation de plus : **l'objet image stocké tient
sous 100 Ko**, garanti par un ré-encodage à qualité dégressive et non par une
valeur de qualité choisie au doigt mouillé. Voir `CIBLE_OCTETS` dans
`apps/api/src/adapters/image-pipeline.ts` et l'ADR 0016.

Trois règles du lot 6, à connaître avant de toucher à `apps/shop` :

- **On n'importe jamais depuis le baril `@catalog/contracts` côté navigateur.**
  Il réexporte les schémas Zod, dont les déclarations ont des effets de bord au
  niveau du module : l'élagage ne les retire pas. Mesuré, l'îlot pesait 20,6 Ko
  compressés au lieu de 1,8. Les sous-chemins existent pour cela (`./money`,
  `./phone`, `./whatsapp`), et une fonction destinée au navigateur ne partage pas
  son module avec un schéma.
- **La boutique ne parle pas à la base.** Elle lit un instantané JSON produit par
  `pnpm shop:snapshot`. Y importer `@catalog/db` inverserait la règle de
  dépendance — et sans instantané, aucune page de boutique n'est construite,
  volontairement.
- **`budget.mjs` mesure PAR PAGE**, pas la somme de `dist/`. Le total du site
  n'est pas ce qu'une acheteuse télécharge. Les images en sont exclues : elles
  sont bornées ailleurs, à 100 Ko par objet.

L'ADR 0017 **révise l'ADR 0016** : les photos de catalogue sont du contenu
public. Les clés restent opaques.

Deux points de vigilance issus du lot 4 :

- **Node exécute le TypeScript en retirant les types, sans les transformer.**
  Une propriété de paramètre (`constructor(private x: T)`), un `enum` ou un
  `namespace` compilent sous `tsc --noEmit`, passent Vitest — qui utilise
  esbuild — et font échouer le serveur **à l'import**. Un test lit les sources
  pour l'empêcher : `apps/api/src/__tests__/node-strip-only.test.ts`.
- **Les plafonds de la limitation de débit sont de la configuration**, pas des
  constantes. Voir `.env.example` : la limite par adresse est celle qui risque
  d'enfermer dehors des vendeuses légitimes derrière une même adresse publique.

L'investigation CamPay est close : l'adaptateur `apps/api/src/adapters/campay.ts`
est **en dormance** derrière `PAYMENT_AGGREGATOR_ENABLED`, absent par défaut.
Aucune route, aucun job, aucun écran ne l'appelle, et un test de garde le
vérifie. On ne l'étend pas sans un nouvel ADR qui rouvre la décision.
