# ADR 0094 — une mesure partielle n'écrase pas une mesure entière

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0089

## Contexte — l'artefact qui se détruisait lui-même

Le harnais du lot d'audit produit trois fichiers dans
`apps/api/src/__tests__/harnais/instantanes/` : le tableau de couverture, la
liste des cases muettes, et les 528 lignes de « ce que chaque geste a reçu ».
Ils sont **produits par exécution et versionnés** — c'est ce qui rend une
régression de couverture visible dans un diff, et c'est tout l'intérêt de
l'ADR 0089 : la couverture est un chiffre mesuré, pas un mot écrit en tête de
tableau.

Les trois `writeFileSync` étaient inconditionnels, et posés **avant**
l'assertion de complétude. Le 14/08, une exécution avec un `DATABASE_URL`
renseigné mais inutilisable a donné ceci :

```
les 22 étapes échouent  →  `jouees` reste vide
                        →  les trois fichiers sont écrits à 0 %
                        →  puis le test échoue
```

`balayage-reponses.md` est passé de 534 lignes à 6, et le tableau a affiché
`0 %` sur les vingt-quatre étapes. Le test échouait bien — mais **après**, et
un `git commit -a` par-dessus aurait remplacé la mesure de l'audit par sa
négation, sans que personne ne l'ait décidé.

Ce n'est pas un cas de laboratoire. Il se produit chaque fois qu'une exécution
est **dégradée sans être sautée** : identifiants en collision (un sel rejoué —
voir `_identifiants.ts`), base migrée à moitié, une étape qui lève. Il ne se
produit **pas** quand la base est absente : là, `describe.skip` saute tout le
bloc et rien ne s'écrit. C'est ce qui rendait le défaut discret — la forme
évidente de l'échec était déjà couverte.

## Décision

**Un instantané ne s'écrit que depuis une mesure complète.** Une exécution
partielle ne laisse rien derrière elle : le fichier du dernier balayage complet
reste en place.

C'est la bonne valeur par défaut, et pour une raison qui vaut au-delà d'ici —
un artefact périmé se date et se rejoue, un artefact écrasé ne se retrouve pas.

Deux conditions, qui disent la même chose sous deux angles (`mesureComplete`
dans `couverture.ts`) :

- `pourcentageGlobal` à 100 — chaque case du catalogue a été jouée ;
- `etapesInconnues` vide — aucune case n'a été jouée sous une étape absente du
  catalogue. Le pourcentage peut valoir 100 malgré tout : il ne compte que les
  étapes **connues**, et le tableau aurait alors un trou qui ne se voit pas.

## La règle est tenue par l'écrivain, pas par l'ordre des lignes

Déplacer l'assertion avant les écritures aurait suffi — ce jour-là. C'est
exactement le genre de correctif qui se défait à la première réorganisation,
sans que personne ne voie que l'ordre portait un invariant.

Le refus vit donc dans `harnais/poser.ts`, qui écrit les trois fichiers ou
n'en écrit **aucun**. Tout ou rien, délibérément : trois fichiers qui se lisent
ensemble ne doivent pas pouvoir dater de deux balayages différents.

`harnais-poser.test.ts` le tient, **sans base** — c'est la condition même de
l'exécution dégradée qu'il décrit. Il vérifie que le refus laisse les fichiers
octet pour octet, y compris dans le cas « 100 % sur les étapes connues, une
étape hors catalogue ».

Le message d'erreur dit ce qui manque **et** ce qui n'a pas été écrit. Sans la
seconde moitié, le lecteur croirait avoir devant lui l'état du disque.

## Ce qui n'a pas changé

Les transcriptions `.txt` des parcours vendeuse et acheteuse n'avaient pas ce
défaut et ne sont pas touchées : elles passent par `toMatchFileSnapshot`, qui
**compare et échoue** au lieu d'écraser. Elles s'écrivent avant les assertions
à dessein — on enregistre ce qui s'est passé — et c'est sans danger pour cette
raison précise.

La frontière de l'ADR 0089 reste où elle est : ce garde-fou parle de la
**complétude** de la mesure, jamais de la **qualité** des réponses. Une case
exercée qui rend une absurdité reste une case exercée, et son instantané doit
s'écrire — c'est même à ça qu'il sert.
