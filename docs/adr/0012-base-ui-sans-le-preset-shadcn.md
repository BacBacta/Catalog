# 0012 — Base UI sans le preset shadcn, et sans ses dépendances de style

- Statut : accepté
- Date : 2026-07-29
- Concerne le lot 2 (`packages/ui`)
- Ne remet en cause aucun choix de la stack : Base UI reste la bibliothèque de
  primitives, et la CLI shadcn a bien servi à produire le point de départ

## Contexte

Le blueprint dit : « Primitives via shadcn CLI 4.16 sur Base UI 1.6 ».

Les deux existent et la commande fonctionne. `shadcn@4.16.0 init --base base`
puis `add` génère les dix primitives demandées, câblées sur `@base-ui/react`.
C'est ce qui a été fait, dans un projet jetable, pour disposer de la source de
référence.

Deux corrections de fait, au passage :

- **Le paquet a changé de scope.** Base UI 1.6.0 se publie sous
  `@base-ui/react` (dépôt `mui/base-ui`, 7,65 M de téléchargements
  hebdomadaires). L'ancien `@base-ui-components/react` s'est arrêté à
  `1.0.0-rc.0` et n'en reçoit plus que 423 K. La version d'AGENTS.md est
  correcte, c'est le nom du paquet qui a bougé.
- **Les presets de la CLI portent une police.** Le preset `nova` installe
  `@fontsource-variable/geist`.

## Le problème

La source générée est bonne sur le comportement — c'est du Base UI enveloppé,
avec les bons `data-slot` et les bonnes signatures. Elle est inutilisable telle
quelle sur trois points, et chacun touche une contrainte non négociable
d'AGENTS.md :

| Ce que produit le preset | Contrainte violée |
|---|---|
| Hauteurs de bouton `h-6` / `h-7` / `h-8`, soit 24 à 32 px | **Cibles tactiles ≥ 44 px** |
| `@fontsource-variable/geist` | **Aucune police téléchargée** |
| `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css` | **30 Ko de JS sur la boutique**, et l'interdit sur toute dépendance > 10 Ko compressés du chemin critique sans ADR |

Un quatrième point, moins grave mais décisif à l'usage : le preset s'exprime
dans **son** vocabulaire de jetons — `bg-primary`, `text-muted-foreground`,
`border-ring`, `--radius-md`, `destructive`. Notre `tokens.css` parle
`brand-fill`, `ink`, `control-line`, `radius-card`. Adopter le vocabulaire
shadcn aurait signifié réécrire nos jetons pour lui ressembler, donc jeter le
travail de contraste déjà validé.

## Décision

**On garde Base UI comme couche de comportement, et les motifs structurels de
shadcn. On jette son style et ses dépendances.**

Concrètement :

- les composants de `packages/ui/src/primitives/` enveloppent
  `@base-ui/react/*` — piège de focus, `aria-modal`, restitution du focus,
  navigation clavier : rien de tout cela n'est réimplémenté ;
- les conventions shadcn conservées : source possédée dans le dépôt (pas une
  dépendance de composants), attributs `data-slot`, API à variantes ;
- le style vient de nos jetons, exclusivement. Aucune couleur en dur ;
- `cva`, `clsx` et `tailwind-merge` sont remplacés par `cx`, dix lignes. Le
  seul service de `tailwind-merge` est de résoudre des classes contradictoires ;
  ici les classes sont écrites à la main, donc il n'y a rien à résoudre ;
- `lucide-react` est remplacé par des SVG en ligne, aux quatre endroits qui en
  ont besoin ;
- aucune police n'est ajoutée. Pile système, comme au lot 1.

Les seules dépendances d'exécution de `packages/ui` sont donc
`@base-ui/react` et `@catalog/contracts`.

## Ce que ça coûte, mesuré

L'app vendeuse passe de 108,4 Ko à 165,3 Ko de JS compressé — le socle coûte
environ **57 Ko**, essentiellement Base UI. Acceptable pour une SPA mise en
cache par le service worker et ouverte plusieurs fois par jour.

La boutique publique reste à **0,0 Ko de JS** : elle importe `tokens.css` et
aucun composant React. C'est ce qui rend la décision tenable — le poids de Base
UI ne touche jamais le chemin critique qui a un budget.

## Ce que ça garantit, et comment on le sait

Trois choses qui n'étaient pas vérifiables avant ce lot le sont maintenant par
la CI :

- **Les contrastes AA, sur les deux thèmes.** `tokens.test.ts` lit `tokens.css`,
  extrait les deux jeux de valeurs et calcule les ratios. Il a d'ailleurs
  attrapé trois violations réelles du socle du lot 1 — `muted` à 2,63:1, `good`
  à 3,35:1 et `warn` à 3,77:1 en mode clair, plus un libellé de bouton plein à
  3,19:1 en sombre — qui ont été corrigées ici.
- **Les 44 px, une fois rendus.** Un test Playwright mesure la géométrie réelle
  de chaque cible. C'était nécessaire : `min-h-touch` ne se résolvait pas,
  parce que `--size-touch` n'est pas un espace de noms que Tailwind mappe sur
  `min-h-*`. La classe était muette, et seule une mesure dans le navigateur
  pouvait le montrer.
- **Le collage n'est jamais bloqué.** Vérifié deux fois : par lecture de la
  source (un `onPaste` qui appelle `preventDefault` est invisible dans le
  balisage) et par un vrai `Ctrl+V` en bout de chaîne.

## À revoir si

- shadcn publie un preset dont les cibles tactiles et le vocabulaire de jetons
  sont configurables sans réécriture. On récupérerait alors ses mises à jour de
  composants sans perdre nos contraintes.
- Base UI passe une majeure. Le comportement des superpositions en dépend
  entièrement, et c'est le genre de montée qui exige de rejouer les tests
  d'accessibilité avant de conclure.
