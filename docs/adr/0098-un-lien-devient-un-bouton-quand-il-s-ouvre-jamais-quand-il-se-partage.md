# ADR 0098 — un lien devient un bouton quand il s'ouvre, jamais quand il se partage

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0086, 0088, 0097

## Contexte

L'ADR 0097 a établi que `cta_url` s'affiche bien comme un bouton, et a conclu :
« la conversion des liens bruts du fil en boutons devient un travail à faire ».
Ce travail est fait. Cet ADR enregistre **la règle qui a décidé quoi
convertir** — parce que le résultat surprend : sur sept liens sortants, **un
seul** est devenu un bouton, et les six autres ne sont pas un reste à faire.

## La règle

> Un lien devient un bouton quand le lecteur doit l'**ouvrir**.
> Il reste du texte quand le lecteur doit le **copier, le partager ou le
> transmettre** — **un bouton ne se copie pas.**

C'est la contrainte que la mesure a rendue visible et qu'aucune documentation
n'annonce : un bouton `cta_url` est une action, pas une chaîne. On ne peut ni
le sélectionner, ni le transférer, ni le coller ailleurs, ni l'ouvrir dans un
autre navigateur.

Deux contraintes s'y ajoutent, l'une de forme et l'autre déjà décidée :

- **Un message ne porte qu'un bouton.** `action.parameters` est un couple
  unique. Et `cta_url` est exclusif des boutons de réponse : un message qui
  propose des choix ne peut pas, en plus, porter un lien-bouton.
- **La frontière de l'ADR 0088 tient.** `cta_url` dit « va voir cette page »,
  jamais « prends cette décision ».

## L'inventaire, et le verdict de chaque lien

| Lien | Où | Verdict | Pourquoi |
|---|---|---|---|
| suivi de commande | carnet acheteuse | **bouton** | elle l'ouvre, et c'est le geste attendu |
| page de vérification `/v/?c=` | carnet acheteuse | texte | « n'importe qui peut contrôler le reçu » — il est fait pour être **montré à un tiers** |
| `wa.me` de la vendeuse | carnet acheteuse | texte | se garde et se rappelle ; et le message porte déjà son bouton |
| lien de boutique | menu vendeuse | texte | « partagez-le, mettez-le en Statut » — en bouton, il perdrait son **seul** usage |
| espace vendeuse | menu vendeuse | texte | ce message porte déjà des boutons de réponse, formes exclusives |
| rampe de paiement `tel:` | bloc paiement | texte | ce n'est pas une page — voir ci-dessous |
| `wa.me` (parler à la vendeuse) | fil acheteuse | texte | même raison que ci-dessus |

## Le seul chemin par lequel ça pouvait casser le produit

La rampe de paiement est un lien `tel:` portant une chaîne USSD (lot 9). En
faire un bouton le rendrait **inerte**, et la panne serait silencieuse :
l'acheteuse verrait un bouton, le taperait, et le composeur ne s'ouvrirait pas.
C'est le geste n° 1 du produit.

`lienBouton()` **lève** donc sur toute URL qui ne commence pas par `https://`,
et un test le tient. Ce n'est pas une convention de nommage qu'on peut oublier
de suivre : c'est une porte fermée.

## Ce qui ne change pas pour l'acheteuse qui ne peut pas ouvrir le bouton

Le contenu canonique — article, quantité, prix, total, boutique, référence,
code de vérification — reste **dans le texte du premier message**, comme
`AGENTS.md` l'exige. Le bouton vit dans le second, le carnet d'adresses. Un
bouton qui ne s'ouvre pas ne lui retire donc rien de ce qu'elle doit savoir ;
il lui retire un raccourci.

Une phrase a changé pour cette raison : « gardez ce **lien** » devient
« gardez ce **message** ». Un bouton ne se garde pas ailleurs que là où il est.

## Le repli, et pourquoi il existe

Si le lien de suivi n'est pas en `https://` — configuration de travers,
environnement à moitié posé —, le carnet **retombe sur la copie d'origine**,
URL en toutes lettres dans le texte.

L'alternative aurait été de lever. Elle est pire : `traiterLivraisonBot` avale
ses exceptions et répond « panne passagère ». La commande serait enregistrée,
et l'acheteuse verrait une erreur — au pire moment, celui où elle vient de
confirmer. Un bouton est un confort ; son absence ne doit pas coûter une
commande.

## L'instrument a été corrigé en même temps

La transcription du harnais rendait `← texte` et le corps du message. Devenue
`← cta_url`, elle aurait montré un corps d'où l'URL venait justement de
partir — sans jamais dire où elle était allée. Elle rend désormais
`← bouton-lien[Suivre ma commande → https://…/suivi/‹jeton›]`.

C'est la même leçon que l'ADR 0096 sur la sonde `RichText` : **un instrument
qui perd de vue ce qui vient de changer ne mesure plus rien.**
