# ADR 0090 — la boutique se relit avant de s'ouvrir

Date : 13/08/2026
Statut : accepté
Révise : ADR 0088 (l'ouverture tient en une bulle), sur le seul nombre de messages

## Contexte — ce que le harnais a mesuré

Le harnais d'audit (ADR 0089) a joué, contre une vraie base, le parcours d'une
prospect qui tape une question à l'étape du nom :

```
bouton « vendre » → « est-ce que vous vendez des chaussures pour bébé ? » → « Douala »
```

Le bot a répondu « *est-ce que vous vendez des chaussures pour bébé ?* — c'est
noté. », puis a ouvert la boutique. En base :

```
businessName = "est-ce que vous vendez des chaussures pour bébé ?"
slug         = "est-ce-que-vous-vendez-des-chaussures-pour-bebe-2"
```

Le constat a été soumis à trois tentatives de réfutation indépendantes
(reproduction, lecture de code, intention produit). **Aucune n'a tenu.** Ce que
la vérification a ajouté est plus grave que le constat de départ :

- **aucun chemin de renommage n'existe nulle part** — ni dans le bot, dont le
  menu n'offre que article / carte / ma boutique / soldes / congés, ni dans
  l'app vendeuse, qui ne connaît que `creerProfil` ;
- **`businessName` n'est couvert par aucun schéma Zod**, alors qu'AGENTS.md §6
  fait de `packages/contracts` la source de vérité des types. En base,
  `business_name` est un `TEXT NOT NULL` sans `CHECK` ;
- **aucun des 88 ADR ne traitait du nom de boutique ni de son slug.** Le seul
  contrôle était une borne de longueur, 2 à 80 caractères.

Le slug lui-même n'est pas en cause : `slugifier` borne déjà à 48 caractères.
Ce qui l'est, c'est qu'un nom devienne une **adresse publique** au deuxième
message, sans que la vendeuse ait rien relu et sans recours ensuite.

## Décision — une bulle de plus, et elle est assumée

Un état `inscription_confirme` s'intercale entre la ville et la création :

> J'ai lu : **Chez Solange**, à **Douala**.
>
> Ce nom sera aussi l'adresse de votre boutique en ligne, celle que vous
> partagerez. On ouvre ?
>
> `[ Ouvrir ✓ ]` `[ Corriger ]`

« Corriger » repose la question du nom. Tout le reste **re-pose la
question** — on ne choisit pas à la place de la vendeuse, exactement comme
l'arbitrage de l'ADR 0052.

### Pourquoi cela révise l'ADR 0088, et pourquoi c'est arbitré et non décidé ici

L'ADR 0088 est daté du **même jour** que cet audit. Il vient de ramener
l'ouverture à une bulle, sur la parole du porteur du produit : « une
multiplication de messages et de liens rendant touffu le chat, c'est
confondant ». Ajouter une bulle vingt-quatre heures plus tard, de notre propre
chef, serait exactement la dérive silencieuse qu'AGENTS.md §7.7 nomme comme le
vrai risque de ce dépôt.

**La décision a donc été posée au porteur du produit, avec la mesure en main, et
c'est lui qui a tranché** : confirmation **et** chemin de renommage. Cet ADR
enregistre son arbitrage ; il ne le prend pas.

### Ce qui a fait pencher

La relecture existe déjà pour l'article photographié — « J'ai lu : *Sac à main* —
*8 000 FCFA*. C'est bon ? ». L'objet le plus difficile à défaire du produit, la
boutique, était le seul à ne pas l'avoir. Un article se corrige ; une adresse
publique déjà partagée, non.

## Conséquences

- Le fil d'ouverture passe de trois à quatre tours. C'est le prix, il est connu.
- L'état `inscription_confirme` entre au catalogue de couverture du harnais :
  ses vingt-deux gestes sont joués, et le balayage échouerait s'il ne l'était pas.
- Deux tests de non-retour : rien n'est créé avant « Ouvrir » ; « Corriger »
  repose la question et le nom repris est celui qui s'ouvre.

## Ce qui reste ouvert

Le **renommage** — l'autre moitié de l'arbitrage — n'est pas dans ce lot. La
confirmation empêche le défaut d'arriver ; elle ne répare pas les boutiques déjà
ouvertes. Il fera l'objet d'un lot à lui, avec sa vraie question : changer le
nom doit-il changer le slug, alors que le lien a peut-être déjà été partagé ?
