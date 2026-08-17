# 0110 — L'aperçu des Flows est généré, pas dessiné

Date : 2026-08-17
Statut : accepté
Complète : 0055 (la spec du Flow et le code ne divergent pas), 0109 (le compte
Meta orphelin)

## Constat — deux sources de vérité pour une seule chose

Le dépôt décrit ses Flows à **deux** endroits :

- `docs/flux-*.json` — les six définitions déposées chez Meta ;
- `docs/terrain/*.html` — des maquettes cliquables, **écrites à la main**.

`flux-spec.test.ts` (ADR 0055) empêche la première de dériver du code, sur un
point précis : les **noms de champs**. C'est le contrat qui casse en silence —
la réponse arrive, aucun champ ne correspond, `lireReponseFlux` rend `null`.

Rien ne surveillait le reste. Une maquette peut promettre un champ que le JSON
n'a pas, garder un libellé de bouton qui a changé, ou montrer un écran unique
là où la définition en enchaîne deux. L'écart ne se voit alors qu'à Douala, sur
un vrai téléphone, par une vendeuse.

Et l'aperçu qui trancherait — `POST /{flow-id}/preview`, qui rend le vrai
pixel — exige un Flow existant chez Meta, donc l'administration du WABA :
gelée depuis le 16/08/2026 (ADR 0109). Il n'y avait donc, dans le dépôt,
**aucun moyen de regarder un Flow**.

## Décision — une page générée depuis le JSON, et rien d'autre

`apps/api/scripts/apercu-flux.ts` lit `docs/flux-*.json` et écrit
`docs/terrain/apercu-flux.html`. Il ne connaît aucune autre source. Tout ce
qu'une vendeuse lit — titres, textes, libellés, aides, ordre, obligation,
options, libellé du bouton, enchaînement, charge utile renvoyée — vient du
JSON, donc ne peut pas mentir.

Quatre choix, et chacun corrige quelque chose :

### Le fichier est versionné, et un test le régénère

`apercu-flux.test.ts` compare le fichier à une régénération et refuse toute
différence. Le HTML committé est donc lisible dans un diff — un changement de
libellé se relit **rendu**, pas seulement en JSON — sans pouvoir prendre du
retard. C'est ce qui autorise à versionner un fichier généré : la seule
alternative honnête serait de ne pas le versionner du tout.

Cela impose une contrainte : la sortie est **déterministe**. Aucune date, aucun
aléa, sinon le test échouerait le lendemain.

### Ce qui est mesuré et ce qui est dessiné sont distingués, sur la page

Le contenu vient du JSON. La chrome — barre de titre, couleurs, espacements,
forme des champs, mention de bas de page — est **dessinée**, donc approximative.
La page le dit en toutes lettres, et renvoie à l'aperçu officiel. Sans cette
ligne, un écart de police se lirait comme un écart de produit (AGENTS.md §7.7).

### Un composant inconnu est bruyant

Un type absent de `COMPOSANTS` rend un bloc **rouge**, et deux tests échouent :
l'un compare le vocabulaire des JSON à la table, l'autre cherche le bloc rouge
dans la sortie. C'est la leçon de l'ADR 0105 : la panne muette coûte plus cher
que la panne visible. De même, un `docs/flux-*.json` absent de l'ordre de
lecture est ajouté à la fin, jamais ignoré.

### Tous les écrans sont visibles, donc il n'y a aucun JavaScript

Une première version masquait les écrans et les faisait défiler au bouton —
plus fidèle au téléphone. Mais un écran caché est un écran qu'on ne relit pas
dans un diff, et c'est pour être relu que la page existe. Les retirer a retiré
tout le JavaScript.

## Ce que la page mesure, en plus de montrer

Elle compte les **gestes** : champs obligatoires plus une pression par écran.
C'est la mesure du « premium » de ce produit — celle que
`docs/terrain/parcours-premium.html` applique aux messages tapés. Mesure du
17/08/2026 :

| Flow | écrans | obligatoires | facultatifs | gestes |
|---|---|---|---|---|
| ouverture | 2 | 3 | 4 | 5 |
| inscription | 1 | 3 | 0 | 4 |
| article | 1 | 2 | 2 | 3 |
| reversement | 1 | 2 | 0 | 3 |
| livraison | 1 | 4 | 1 | 5 |
| avis | 1 | 1 | 1 | 2 |

## Ce que la page a rendu visible du premier coup

- **`livraison` est le seul Flow sans texte d'introduction**, et c'est aussi
  le plus exigeant : quatre champs obligatoires, ouvert par « Ville » sans un
  mot d'explication. À trancher, pas à corriger au passage.
- **Le second écran de l'ouverture n'a aucun champ obligatoire.** C'est voulu
  (ADR 0087 — une boutique s'ouvre sans article), mais il se lit maintenant.

## Ce que cet ADR ne décide pas

Le vocabulaire disponible. Nos six définitions n'emploient que **dix**
composants en version **7.0**, et savoir ce que Meta accepte au-delà se mesure
par un téléversement — donc après le dégel de l'ADR 0109. La page ne dit pas
ce qui manque, elle dit ce qui est.

## Le script en une ligne

```bash
node apps/api/scripts/apercu-flux.ts             # écrit la page
node apps/api/scripts/apercu-flux.ts --verifier  # dit si elle est périmée
```

Il est en TypeScript alors que `scripts/` est en `.mjs`, parce qu'un test
l'importe : en `.mjs`, `tsc` refuse l'import faute de déclarations, et la seule
issue serait un `.d.mts` écrit à la main — une seconde source de vérité, c'est-
à-dire précisément ce que ce script existe pour supprimer.
