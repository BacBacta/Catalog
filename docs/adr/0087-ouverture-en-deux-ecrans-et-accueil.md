# 0087 — L'ouverture tient en un formulaire, et le fil accueille avant qu'on écrive

- **Statut** : accepté
- **Date** : 13/08/2026
- **Complète** : l'ADR 0086 (le fil cesse de noyer) et l'ADR 0063 (les Flows
  comme raccourcis, jamais comme passage obligé).

## Ce que Meta permet, vérifié et non supposé

Trois lectures de la documentation, le 13/08/2026 :

1. **Les Flows multi-écrans fonctionnent sans point de terminaison.** « Le
   modèle de routage est généré automatiquement si votre Flow n'utilise pas
   de Data Endpoint. » `navigate` enchaîne les écrans, les données
   s'accumulent dans la charge utile et **reviennent ensemble au
   `complete`**. Seul `data_exchange` exigerait un serveur — on ne l'emploie
   pas.
2. **Les composants existent** : `Image` (3 max par écran), `RichText` (5.1+,
   markdown), `EmbeddedLink`, `If`/`Switch`. Notre Flow JSON est en 7.0.
3. **`cta_url` n'est PAS confirmé.** Le bouton-lien est annoncé dans les
   guides — « mapper une URL sur un bouton, pour ne pas avoir à mettre des
   URL brutes et longues dans le corps du message » — et **absent de la
   référence des messages**, qui liste `button`, `list`, `flow`, `product`,
   `catalog_message`, `call_permission_request`. Deux sources officielles se
   contredisent : c'est exactement le cas où AGENTS.md §7.7 interdit de
   supposer.

## Décision 1 — l'ouverture en deux écrans, un seul formulaire

`catalog_ouverture` remplace `catalog_inscription` quand il est posé :

- **écran 1** : nom de boutique, ville, langue → `navigate` ;
- **écran 2** : premier article — nom, prix, stock, photo → `complete`, qui
  rend **tout**, les deux écrans à la fois.

Un seul `nfm_reply`, une seule lecture (`lireOuvertureFlux`), et l'ouverture
tombe d'une salve à un formulaire. `WABOT_FLUX_OUVERTURE_ID` absente, le fil
est exactement celui d'avant — la règle de l'ADR 0063 tient : un Flow ne
s'affiche pas sur un WhatsApp ancien, la saisie libre reste le chemin qui
marche partout.

**La boutique commande, l'article est facultatif.** Si la boutique ne se lit
pas, rien ne se lit — on ne range pas un article sans boutique. Le second
écran laissé vide ouvre quand même la boutique : c'est le cas d'une vendeuse
qui n'a pas sa photo sous la main. Un article à moitié rempli (un nom sans
prix) vaut absent, jamais un échec.

## Décision 2 — le fil accueille avant qu'on écrive

Les **amorces** (« ice breakers ») répondent à la demande du banc : « la
boutique doit interagir directement lorsque l'utilisateur se connecte, même
sans rien écrire ». Elles s'affichent dans WhatsApp au premier ouvrage du
fil, **avant tout message**, et c'est Meta qui les rend — nous n'initions
rien, l'invariant tient.

Quatre au plus, 80 caractères chacune. Les nôtres ne sont pas des slogans :
chacune est un **geste que le bot sait déjà exécuter**, et le mot qu'elle
envoie est celui que la machine reconnaît — « Je veux vendre », « Voir une
boutique », « Où est ma commande ? », « Aide ». S'y ajoutent quatre
commandes (`/vendre`, `/boutique`, `/suivi`, `/aide`).

Elles se posent sur le **numéro**, une fois, par
`composants.mjs --accueil-poser` — et `--accueil-etat` les lit sans rien
changer. Une lecture qui échoue ne conclut rien : surtout pas « rien n'est
posé ».

## Décision 3 — `cta_url` se mesure avant de servir

`composants.mjs --mesurer-cta <numéro>` envoie **un** message de cette forme
et rend le verdict de l'API : accepté avec l'identifiant du message, ou
refusé avec son code et sa raison. La mesure envoie un vrai message — c'est
le seul moyen de savoir — et c'est pourquoi elle exige un numéro explicite
plutôt que d'en deviner un.

Tant que la mesure n'a pas eu lieu, **aucun code ne dépend de `cta_url`** :
les liens restent en texte, et la réduction de l'ADR 0086 n'en dépendait
pas. C'est la même méthode que pour `PhotoPicker` le 12/08 — mesurer, puis
décider, jamais l'inverse.
