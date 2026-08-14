# ADR 0100 — l'adresse d'une boutique homonyme passe par la ville

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0073, 0098

## Le défaut, trouvé en cherchant autre chose

`slugLibre` construisait l'identifiant d'URL d'une boutique ainsi :

```ts
for (let i = 0; i < 50; i++) {
  const essai = i === 0 ? base : `${base}-${i + 1}`;
  …
}
throw new Error(`aucun identifiant d'URL libre pour « ${base} »`);
```

Cinquante homonymes **globaux** — toutes villes confondues —, puis une levée.
Le commentaire de la fonction disait déjà que « chez tantine » n'est pas un nom
rare : le plafond était atteignable, pas demain, mais pas jamais.

Il a été atteint le 14/08/2026, par accident : quarante exécutions de la suite
de tests, lancées pour reproduire l'intermittence de l'ADR 0099, ont créé
cinquante boutiques « Chez Solange ». La cinquante-et-unième ouverture levait.

**Et elle cassait mal.** `traiterLivraisonBot` avale ses exceptions et répond
« panne passagère » : la vendeuse ne pouvait pas ouvrir sa boutique et
n'apprenait **jamais pourquoi**, quoi qu'elle réessaie. Le seul chemin
d'entrée du produit, fermé sans un mot.

## Décision

L'échelle passe par la ville :

```
chez-solange  →  chez-solange-douala  →  chez-solange-douala-2  →  …
```

La ville est déjà demandée à l'inscription (ADR 0050) et déjà stockée : rien de
neuf n'est réclamé à la vendeuse.

## Pourquoi la ville plutôt qu'un numéro ou un tirage

Trois options étaient sur la table. Le numéro était le statu quo ; le tirage
aléatoire règle la capacité et rien d'autre.

**Ce qui a tranché n'est pas la capacité, c'est la lisibilité.**
`chez-solange-douala` dit quelque chose ; `chez-solange-7` ne dit rien, et
`chez-solange-k3f9` dit moins que rien. Or cette adresse n'est pas une clé
technique : elle est **mise en Statut WhatsApp**, collée dans une conversation,
lue avant d'être cliquée (ADR 0098). Une acheteuse de Douala qui voit la ville
dans l'adresse sait qu'elle est au bon endroit.

La capacité suit, accessoirement : cinquante **par ville** au lieu de cinquante
en tout.

## Les bords, et pourquoi ce sont des replis et non des levées

- **Pas de ville** — la fonction est publique et un appelant peut ne pas en
  avoir : l'ancienne échelle numérique reprend.
- **Une ville qui ne slugifie en rien** (`slugifier` rend « boutique » faute de
  lettres) : numéro également. Coller `-boutique` à une adresse serait pire que
  de la numéroter.
- **Saturation quand même** — cinquante « Chez Solange » dans la *même* ville :
  la levée subsiste, mais son message **nomme la ville**. Sans elle, il ne
  disait pas où le problème se posait, et la suite n'était pas décidable.

## Ce qui ne change pas

**Les adresses existantes ne bougent pas.** Le slug est posé à la création et
n'est jamais recalculé — c'est la règle de l'ADR 0092 (renommer une boutique ne
change pas son adresse) et de l'ADR 0073 (une adresse déjà partagée est une
promesse). Cette décision ne vaut que pour les boutiques à venir.

## Ce qui reste ouvert

La levée résiduelle produit toujours « panne passagère » côté vendeuse. La
rendre lisible — lui dire que le nom est déjà pris dans sa ville et lui en
proposer un autre — demande une copie et un point d'entrée dans la machine du
bot. Ce n'est pas fait ici : la décision d'aujourd'hui rend l'événement assez
rare pour qu'il cesse d'être le premier sujet, pas assez pour qu'il disparaisse.
