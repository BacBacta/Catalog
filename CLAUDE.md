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
lot 8 (analyseurs de SMS, sept contrôles, écran de collage).

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
