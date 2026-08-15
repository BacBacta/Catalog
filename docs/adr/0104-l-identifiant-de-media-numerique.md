# 0104 — La photo du formulaire se mesure, et l'identifiant numérique se lit

Date : 2026-08-15
Statut : accepté
Prolonge : 0079 (le média CDN chiffré des Flows), 0102 (la cause se dit),
0103 (la cause se journalise)

## Le défaut, et pourquoi il était invisible jusqu'à ce soir

Un formulaire d'article rempli **avec** photo produisait :

> Sans photo pour l'instant — envoyez-la quand vous voulez.

C'est la phrase du cas « rien n'a été tenté » — pas celle d'un échec. Le
lecteur (`photoDe`) ne reconnaissait donc pas la forme livrée, et déclarait
la photo absente. Avant les ADR 0102 et 0103, ce cas était muet ; c'est la
précision de la phrase qui a orienté l'enquête vers le lecteur plutôt que
vers le pipeline.

## La mesure d'abord — §7.7, et le précédent de l'ADR 0079

Deux formes étaient connues : `id`/`media_id` en **chaîne** (documentée), et
`cdn_url`+`encryption_metadata` (découverte au banc du 12/08). Plutôt que de
deviner une troisième, `formePhotoFlux` rend le **squelette** du champ —
types, clés, longueurs, profondeur bornée, **jamais une valeur** : ni
identifiant, ni URL de CDN (elle porte les clés de déchiffrement), ni
octets. C'est ce régime (le même que les traces, ADR 0023) qui autorise le
squelette à partir au journal, via les deux entrées de formulaire qui
portent une photo, et à se lire par la sonde `sonde-photos`.

La mesure du 15/08 au soir, sur le téléphone du porteur du produit :

```
tableau[1]:{ id: nombre, mime_type: chaine(10), sha256: chaine(44), file_name: chaine(40) }
```

**L'identifiant arrive en NOMBRE JSON.** Ni chaîne, ni CDN : une troisième
forme, qu'aucune documentation ne décrit.

## Décision 1 — le nombre est accepté, converti en chaîne exacte

`photoDe` accepte un `id` (ou `media_id`) numérique entier positif et le
rend en chaîne : c'est le même identifiant que la forme chaîne, et il
rejoint le même chemin (`media.lire`).

## Décision 2 — au-delà de 2⁵³, on relit le brut, on ne convertit jamais

`JSON.parse` perd la précision au-delà de `Number.MAX_SAFE_INTEGER`, et un
identifiant Meta peut dépasser seize chiffres : `27695141573488361` devient
`…360` — un identifiant **faux** qui produirait un 404 en ressemblant à un
vrai. Hors zone sûre, l'identifiant exact se **relit dans le texte brut** de
la réponse, où les chiffres sont intacts (`idNumeriqueDuBrut`). Si cette
relecture échoue, la photo vaut absente : on ne fabrique jamais un
identifiant approximatif.

L'hypothèse qui rend la relecture sûre est structurelle : dans les réponses
d'article et d'ouverture, le **seul** champ numérique nommé `id` est celui
de la photo — `flow_token` et les champs de saisie sont des chaînes, et le
contrat de champs est tenu par le test miroir de `flux-spec.test.ts`.

## Ce qui change dans un test existant, et pourquoi c'est légitime

`flux-trois.test.ts` rangeait `[{ id: 42 }]` parmi les formes inattendues,
avec ce commentaire : « la forme LIVE du tableau n'a que la doc pour elle
tant qu'une vraie soumission ne l'a pas confirmée ». Une vraie soumission
vient de confirmer la forme numérique : elle quitte la liste des inattendus
et gagne ses propres tests. C'est le devenir que ce commentaire promettait.

## Ce que cet ADR NE fait pas

- Il ne retire pas l'instrument : `formePhotoFlux` reste branché. La
  prochaine forme inconnue — il y en aura — se mesurera au lieu de se taire.
- Il ne touche ni au pipeline d'images, ni au téléchargement du média : la
  mesure a montré que le défaut était **avant** eux.

## Preuves

- `flux-trois.test.ts` — l'id numérique sûr rendu en chaîne exacte ; l'id
  au-delà de 2⁵³ relu dans le brut (le test vérifie d'abord que `JSON.parse`
  a bien perdu le chiffre) ; la forme chaîne inchangée ; l'ouverture servie
  par le même lecteur ; et le squelette qui décrit sans jamais montrer.
- La mesure elle-même : run `31905568625` de « Operations preproduction »,
  sonde `sonde-photos`, 15/08/2026 20:01 UTC.
