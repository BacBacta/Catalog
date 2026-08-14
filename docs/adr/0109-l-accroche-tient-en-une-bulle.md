# ADR 0109 — l'accroche tient en une bulle, et cesse de se redire

Date : 14/08/2026
Statut : accepté
Révise : ADR 0103 (les trois portes, en boutons) et ADR 0108 (la longueur de
l'explication) — sur la FORME du premier contact, jamais sur ce qu'il dit.

## Ce que le porteur du produit a vu, sur son téléphone

Trois captures du fil, à 22 h 47, en ouvrant une conversation neuve. Ses
mots : « en accroche je reçois ces messages, ils me semblent mal coordonnés
et redondants ».

Deux bulles, la même minute :

1. l'accueil — « Je suis Catalog… Que puis-je faire pour vous ? » — et ses
   **trois boutons** : *Vendre avec Catalog*, *Suivre ma commande*,
   *Comment ça marche ?* ;
2. la réponse à la troisième — « Vous vendez déjà sur WhatsApp… » —, coupée
   par un **« Voir plus »**, et **reposant deux des trois mêmes boutons**.

Sur la troisième capture, « Vendre avec Catalog » apparaît **deux fois dans
un même écran**.

## Les trois défauts, mesurés

**1. Le message se faisait couper là où il servait.** Le corps de
`commentCaMarche` faisait **957 caractères** ; WhatsApp l'a replié après
**~776**. Les 181 caractères cachés étaient exactement les deux dernières
lignes :

> Pour commencer : le nom de votre boutique et votre ville. Deux minutes…
> Vous attendez plutôt une commande ? Touchez « Suivre ma commande ».

C'est-à-dire l'appel à l'action et la sortie de secours — les deux lignes que
l'ADR 0108 avait écrites pour **fermer sur un geste et non sur un manque**.
Le dispositif anti-churn existait, et personne ne le voyait.

**2. Les gestes se doublaient à l'écran.** La réponse reposait `vendre` et
`suivi`, déjà offerts trois lignes plus haut. Les anciens boutons d'un fil
restent touchables — le produit le sait déjà, `boutiqueFermee` existe pour
« un ancien bouton du fil qui tente encore de commander ». Il y avait donc
deux chemins vivants pour un seul geste, sans indice de celui qui compte.

**3. Le contenu se redisait.** L'accueil annonce en 155 caractères ce que
Catalog fait pour chacun des trois publics ; l'explication redisait les mêmes
trois idées six fois plus longuement, « deux minutes » compris.

## La racine : trois boutons ne portent que trois libellés nus

C'est le mur mesuré au banc du 13/08 et résolu, **côté vendeuse**, par l'ADR
0088 : WhatsApp ne hiérarchise pas, trois boutons ne tiennent pas ce qu'une
personne neuve peut vouloir faire, donc le reste retombe en texte — et le
texte n'a pas de fin.

L'ouverture vendeuse est passée de quatre bulles à une en devenant une
**liste** : dix lignes possibles, chacune avec sa description, plus un pied.
L'accueil froid, lui, était resté en boutons. Le même mur a produit le même
effet.

## Décision 1 — l'accueil froid devient une liste

`accueilFroid` rend **un** message de type liste, employé aux deux endroits
qui accueillaient (l'ouverture de fil de l'ADR 0106, et le premier message
écrit) :

- **corps** : la copie de l'ADR 0103, inchangée ;
- **menu** : les trois portes, identifiants inchangés — `vendre`, `suivi`,
  `comment` —, chacune avec sa description ;
- **pied** : « Vous avez le lien d'une boutique ? Ouvrez-le ici. »

Le pied porte la seule consigne qui ne tient dans aucune ligne, et il est
**positif** : l'ADR 0108 a retiré le « il n'y a pas d'annuaire ici », un
négatif en dernière ligne du premier message. Ne pas le promettre suffit.

Les descriptions ne sont pas un ornement : **c'est ce qui rend la deuxième
bulle inutile.** Un test refuse une ligne sans description.

## Décision 2 — l'explication ne redonne plus ce qui est déjà offert

La réponse à « Comment ça marche ? » redevient **un texte**, sans boutons.
Elle nomme le geste — « écrivez *vendre* », « touchez *Suivre ma commande*
au-dessus » — au lieu de le dupliquer. Les deux mots écrits sont reconnus
(`demandeInscription`, `demandeStatut`) : la sortie ne dépend pas du menu
resté plus haut dans le fil.

## Décision 3 — l'accroche tient sous le pli, et un test le garde

`commentCaMarche` passe de **957 à 616 caractères** en français (553 en
anglais), et de treize lignes à dix. Les quatre peurs de l'ADR 0108 restent
répondues dans le même ordre, et les tests qui les tiennent une par une n'ont
pas bougé.

Le plafond est fixé à **640 caractères** dans `couverture.test.ts`.

> **Ce plafond est un substitut, et il faut le savoir avant de le déplacer.**
> Le pli de WhatsApp se calcule en lignes rendues — donc en largeur d'écran et
> en taille de police —, pas en caractères. 640 est calibré sur une mesure
> unique : la coupure à ~776 sur un téléphone, le 14/08. La marge est là pour
> une police plus grande, pas pour du confort d'écriture.

## Le piège qui aurait rendu le menu muet

Une ligne de liste touchée arrive en `genre === "liste"`, jamais `"bouton"`.
Deux endroits ne lisaient que les boutons :

- `aiguillage.ts`, règle 2 — la porte `vendre`, c'est-à-dire **la première
  porte de l'entonnoir** ;
- `conversation.ts`, le bloc sans boutique — `suivi` et `comment`.

Sans le changement, les trois lignes n'auraient rien fait : pas d'erreur, pas
de trace, un menu mort. C'est le même silence que celui de l'ADR 0088, et il
est tenu par deux tests, pas par la mémoire — la forme liste doit rendre
exactement ce que la forme bouton rendait.

## Ce que ce lot ne fait pas

- **Le premier contact reste à deux bulles quand on demande l'explication**,
  et c'est voulu : la deuxième répond à une question posée. Ce qui est retiré,
  c'est qu'elle se redise et se redouble.
- **La suite de « Vendre » reste à deux messages** — la question du nom, puis
  l'offre de formulaire (ADR 0087). Les fondre exigerait de choisir entre le
  Flow et la question, or la question est le seul chemin qui marche sur un
  WhatsApp ancien. À rouvrir avec une mesure, pas au détour de celui-ci.
- **Le pidgin ne bouge pas** : `wes` retombe sur le français pour ces clefs
  (ADR 0034), et les nouvelles descriptions suivent le même repli tant qu'une
  locutrice n'a pas relu.
