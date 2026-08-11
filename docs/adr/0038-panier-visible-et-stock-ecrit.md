# 0038 — Le panier se voit, et le stock cesse d'être écrit par personne

Date : 04/08/2026 · Statut : accepté · Complète : 0033, 0035

## Contexte

Deux trous ouverts par les tranches précédentes, signalés à l'époque, refermés
ici. Ils ne se ressemblent pas : le premier est un manque d'affichage, le second
est un mensonge d'instrumentation — la catégorie de défaut que le lot 13 a
interdite ailleurs et qu'on laissait vivre ici.

**Le panier ne montrait que son total.** Depuis l'ADR 0033 une acheteuse peut
mettre plusieurs articles dans une commande, mais l'étape « et ensuite ? » ne
disait que « Panier : 38 000 F ». La première fois qu'elle relisait ses lignes
était le **récapitulatif**, c'est-à-dire après avoir saisi son quartier, son
repère et son téléphone. Se tromper d'article coûtait donc de tout reprendre.

**Le stock était lu partout et écrit nulle part.** La colonne existe depuis le
lot 5. Le bot borne les quantités dessus (`maxCommandable`), la fiche article
l'affiche, la boutique publique l'affiche, l'`ADR 0033` en a fait une règle de
conversation. Et **aucune interface ne permettait d'y toucher** : ni le
formulaire vendeuse, ni le fil WhatsApp. La valeur en base était donc `0` pour
tout le monde, c'est-à-dire « non suivi », c'est-à-dire que tout ce code ne
s'exécutait jamais en production.

## Décision 1 — Le panier montre ses lignes, à chaque passage

`panierCorps` prend désormais les lignes ET le total. Toute arrivée à l'étape
panier — ajout, « Corriger » depuis le récapitulatif, mot-clé — affiche le
contenu complet.

L'accusé de réception de l'ajout (« ✅ Ajouté : Sac en raphia × 1 ») est
**conservé et distinct** du corps du panier : il répond à « est-ce que ça a
marché ? », question que la liste ne répond pas. Il n'apparaît que lorsqu'on
vient effectivement d'ajouter quelque chose.

## Décision 2 — « panier » est un mot-clé global, et il a deux entrées visibles

Le quatrième mot valable partout, à côté de « menu », « annuler » et « aide ».
Il ramène à l'étape panier depuis n'importe quel état, **y compris en plein flux
de livraison** — l'endroit exact où l'on doute de ce qu'on a choisi.

Un mot-clé que personne ne connaît n'existe pas. Il a donc deux affordances :

- une **ligne en tête de la liste catalogue**, avec le total en description ;
- un **troisième bouton sur la fiche article**.

Les deux n'apparaissent que si le panier contient quelque chose : un raccourci
vers rien est du bruit. Les bornes de WhatsApp sont respectées par construction
— 8 articles + « voir la suite » + cette ligne font exactement les 10 lignes
qu'une liste accepte, et la fiche reste à trois boutons.

Panier vide, le mot répond « votre panier est vide » **sans changer d'état** :
il ne fabrique pas une étape de commande là où il n'y a pas de commande.

## Décision 3 — Le stock devient saisissable, replié avec la description

Le formulaire article garde sa règle : **photo, nom, prix**, et rien d'autre sur
le chemin obligé. Le stock rejoint la description derrière le même `<details>`,
qui s'appelle maintenant « Description et stock (facultatif) ».

Le champ **vide** vaut « je ne compte pas », et c'est le défaut. Ce n'est pas la
même chose que zéro, et l'inverse est vrai aussi : un article relu avec `0` en
base affiche un champ **vide**, jamais « 0 » — sinon la vendeuse lirait sa
boutique en rupture.

La liste des articles porte un badge `N en stock` quand le nombre est posé,
`warn` en dessous de quatre. Zéro n'affiche rien : il n'y a rien à dire.

## Décision 4 — Le nombre ne se décompte PAS tout seul, et c'est écrit

C'est le point qui aurait pu se combler en silence, et qui ne doit pas.

Décrémenter le stock à la création d'une commande suppose des **sémantiques de
réservation** que personne n'a arbitrées : une commande créée puis jamais payée
libère-t-elle l'article, et au bout de combien de temps ? une commande expirée ?
annulée ? contestée ? Et surtout : la vendeuse vend aussi **en face à face et
dans son propre fil WhatsApp**, hors de tout ce que Catalog voit. Un compteur
qui ne décompte que la moitié des ventes est plus faux qu'un nombre qu'elle
tient elle-même.

Donc : le nombre est un **plafond par commande**, maintenu par la vendeuse. La
décision de le transformer en inventaire réservé est une décision produit, à
prendre avec des données de terrain, et elle exigera son propre ADR (AGENTS.md
§7.7).

Ce que ça change, ce sont les **mots** — un chiffre qui ne bouge pas ne doit
pas jouer la rareté :

| Avant | Après |
|---|---|
| « Plus que 2 en stock ! » | « Plus que 2 disponibles » |
| « Il n'en reste que 2. » *(boutique)* | « La vendeuse en annonce 2. » |
| *(rien)* | « Ce nombre ne baisse pas tout seul : corrigez-le quand vous vendez. » *(app vendeuse)* |

L'exclamation promettait une urgence que le système ne garantit pas. La boutique
publique attribue désormais la déclaration à celle qui la fait.

## Ce que ça ne fait pas

- **Retirer une ligne du panier** reste reporté (ADR 0033) : « annuler » vide
  tout, « corriger » revient au panier. Le besoin n'est toujours pas constaté.
- **Le stock ne se saisit pas depuis le fil WhatsApp.** L'inscription vendeuse
  y crée nom, prix et photo ; ajouter un quatrième pas au parcours d'onboarding
  pour un champ facultatif serait exactement ce que la règle des trois champs
  refuse.
- **`product.variants` reste une colonne morte.** Rien ici ne la réveille.
