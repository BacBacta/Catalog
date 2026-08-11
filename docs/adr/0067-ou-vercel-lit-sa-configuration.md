# 0067 — Où Vercel lit sa configuration

Date : 11/08/2026
Statut : accepté
Corrige : une croyance écrite dans `apps/shop/scripts/entetes.mjs`, exacte pour
la boutique et fausse pour l'app vendeuse
Concerne : `apps/seller/vercel.json`, `apps/seller/vite.config.ts`,
`docs/runbooks/deploiement.md`

## Ce qui a été mesuré

**Vercel lit `vercel.json` à la racine du répertoire qu'on lui DÉPLOIE.** Ce
répertoire n'est pas le même selon le chemin de déploiement, et c'est là toute
l'affaire :

| chemin | ce qu'on envoie | racine lue |
|---|---|---|
| `cd apps/seller/dist && vercel deploy` | la sortie construite | `dist/` |
| construction déclenchée depuis git | les sources | `apps/seller/` |

Le dépôt ne connaissait que le premier. Le second s'est ouvert le 11/08/2026,
quand le projet `catalog-vendeuse-preprod` a été relié au dépôt pour que la
PR ait une prévisualisation.

## La panne, et sa forme

Le déploiement a **réussi**. L'application était servie. Et pourtant :

```
/            → 200   l'app vendeuse
/commandes   → 404   le repli SPA n'existe pas
/api/rampe   → 404   le renvoi vers l'API Fly n'existe pas
en-têtes     → aucun
```

`vercel.json` vivait dans `apps/seller/public/`, d'où Vite le recopie dans
`dist/`. Il n'existe donc **qu'après construction** — invisible pour une
construction qui lit les sources.

C'est exactement la forme de panne que ce fichier existe pour empêcher, et que
son propre commentaire côté boutique décrit : *« sans la moindre erreur »*. Un
déploiement vert, une application ouverte, et trois fonctions absentes.

## Pourquoi celle-là fait mal

Le renvoi `/api/*` n'est pas un confort de routage : c'est ce qui garde le
cookie de session **de même origine**. Sans lui, le navigateur le traite comme
un cookie tiers et le jette — la vendeuse est déconnectée à chaque ouverture,
sans message qui l'explique.

Ce défaut-là a déjà coûté une matinée, le 11/08 même : un 401 de session qui
s'annonçait « L'article n'a pas pu être créé » — la connexion marchait, le
message mentait (corrigé dans `apps/seller/src/lib/api.ts`). Une
prévisualisation qui sert l'app sans son proxy remettrait exactement la même
confusion sous les yeux de la première personne qui l'ouvre.

## La décision

Le fichier vit à **`apps/seller/vercel.json`**, la racine de l'app, et
`vite.config.ts` le recopie dans `dist/` en fin de construction.

Une seule source, deux destinations. L'alternative — un fichier à chaque
endroit — mettrait deux vérités pour la même politique, et elles divergeraient
le jour où quelqu'un n'en corrige qu'une.

`src/__tests__/vercel-json.test.ts` tient quatre choses : le fichier est à la
racine, il n'est **plus** dans `public/`, le renvoi `/api/*` précède le repli
SPA — l'ordre compte, le repli attrape tout —, et la copie de `dist/` est
identique.

## Ce qui ne change pas, et pourquoi les deux apps diffèrent

**La boutique garde son `vercel.json` produit dans `dist/`, et elle a raison.**
Vérifié en production le même jour : `Referrer-Policy: no-referrer` est bien
servi, la CSP à empreintes aussi, et `/v/ACDE-4679` rend 200 — la jolie URL de
reçu de l'ADR 0021 fonctionne.

La différence n'est pas une incohérence, elle suit la règle ci-dessus :

- `catalog-boutique-preprod` **n'est pas relié à git** (vérifié : `link: null`).
  On lui envoie `apps/shop/dist` déjà construit, donc `dist/` **est** la racine
  déployée.
- Son contenu ne serait de toute façon pas reproductible hors du build : la CSP
  porte les empreintes des scripts émis, et `connect-src` dépend de
  `PUBLIC_API_BASE`. C'est un artefact de construction (ADR 0016 pour la même
  famille de raisonnement).

Quiconque voudra « harmoniser » les deux emplacements doit lire ce paragraphe
d'abord : les rapprocher casserait l'un des deux.

## Deux réglages Vercel corrigés au passage

1. **Root Directory** valait `app/seller` — sans le `s`. Le dossier n'existe
   pas ; le déploiement s'arrêtait avant l'installation.
2. **Output Directory** n'était pas posé. Sans framework déclaré, Vercel a
   deviné `build` (le défaut de Create React App, `react` et `react-dom` étant
   dans les dépendances) là où Vite écrit `dist`. La construction réussissait
   entièrement, puis échouait sur `No Output Directory named "build" found`.
   Posé explicitement à `dist`.

Ces deux-là vivent dans le tableau de bord, pas dans le dépôt : ils ne sont pas
tenus par un test, et c'est une fragilité connue. La poser dans `vercel.json`
serait possible pour la seconde ; ce n'est pas fait, parce que la valeur du
tableau de bord l'emporte sur ce point selon le chemin, et qu'une deuxième
vérité qui gagne parfois est pire qu'une seule qui vit ailleurs.

## Conséquences

- Une prévisualisation par PR qui sert réellement l'app vendeuse — proxy,
  repli SPA et en-têtes compris.
- Le chemin du runbook (`cd dist && vercel deploy`) fonctionne inchangé.
- 4 tests neufs.
