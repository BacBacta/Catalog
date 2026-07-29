# 0009 — V1 sans agrégateur : dépôt direct et preuve par SMS

- Statut : accepté
- Date : 2026-07-29
- Remplace l'orientation de l'ADR 0007 pour la v1 ; le conserve comme option d'évolution
- S'appuie sur l'ADR 0008 et sur la sonde du bac à sable CamPay
- Rédigé sous le nom « Swap », renommé « Catalog » par l'ADR 0010 le même jour.
  Le corps du texte porte le nouveau nom ; le fichier, lui, n'est pas réécrit.

> **Identifiants pseudonymisés.** Les identifiants de transaction cités ici ont
> la forme exacte des originaux, mais pas leurs chiffres. Voir la note de
> confidentialité de `docs/formats-sms-operateurs.md` : aucun identifiant réel
> n'entre dans le dépôt.

## Contexte

Trois architectures d'encaissement ont été examinées : USSD pré-rempli sans
observabilité, paiement marchand direct exigeant une formalisation, et
agrégateur agréé. L'ADR 0007 avait retenu la troisième, au motif qu'elle seule
apportait un **témoin** capable d'attester le paiement — donc le reçu
vérifiable, qui est la valeur numéro un du produit.

L'intégration a été poussée jusqu'au bac à sable de CamPay. Ce que la sonde a
révélé retourne l'argument.

## Ce que la sonde a établi

**1. La signature de l'agrégateur n'atteste rien.** La réponse de statut porte
un JWT HS256 signé avec la clé webhook. Sa charge utile ne contient **ni
référence, ni montant, ni statut**. Deux transactions différentes émises dans
la même seconde ont produit un jeton **identique octet pour octet**, valable
une heure. C'est un jeton de porteur rejouable, pas une signature de
transaction. Une signature valide autorise à dire « l'agrégateur a émis un
jeton récemment », jamais « ce paiement a eu lieu ».

> **Le témoin que l'ADR 0007 allait chercher chez l'agrégateur a un
> témoignage vide.** Le seul témoin sérieux reste l'opérateur, et il parle
> déjà — par le SMS qu'il envoie à la vendeuse.

**2. La référence de l'opérateur existe, mais n'est pas établie.** Le champ
`operator_reference` est bien présent (`18100000001` chez MTN,
`MP260729.1716.C73941` chez Orange), et se retrouve dans `/api/history/` sous
le nom `operator_tx_code`. Mais il était **vide sur les transactions
`SUCCESSFUL`** et renseigné seulement sur une `PENDING` et une `FAILED` — or
c'est le cas abouti, et lui seul, qui nous intéresse. Le bac à sable étant
manifestement synthétique sur ce chemin (succès à 0,00), la question reste
ouverte.

**3. Le rapprochement est plus faible que prévu.** `/api/history/` ne porte pas
notre `external_reference` : le rapprochement ne peut passer que par l'UUID
interne de l'agrégateur, et exclut les `PENDING`.

**4. Le modèle sous-marchand n'existe pas.** `collect` n'accepte toujours aucun
bénéficiaire. Les fonds atterrissent sur un solde marchand, incompatible avec
l'ADR 0006.

**5. Le coût ne le justifie plus.** Aller-retour encaissement + reversement
autour de 3 %, contre 2,22 % pour un dépôt direct hors réseau (mesuré sur un
SMS réel) et une promotion à 0 F sur le même réseau.

## Décision

**La v1 se passe d'agrégateur.**

- **Paiement** : dépôt direct, du portefeuille de l'acheteuse vers celui de la
  vendeuse. Catalog n'est jamais dans le flux.
- **Initiation** : la rampe. Un lien `tel:` ouvre le clavier **pré-rempli**
  avec le bon numéro et le bon montant. Le code d'entrée dépend de l'opérateur
  — `*126#` chez MTN, `#150*50#` chez Orange — et doit être **choisi selon
  l'opérateur, jamais figé en constante**. Le code secret se saisit dans la
  session de l'opérateur : Catalog ne le voit pas.
- **Preuve** : la vendeuse colle le SMS de l'opérateur. Catalog en extrait
  montant, numéro, identifiant et horodatage, applique sept contrôles
  numérotés dans cet ordre — 1 format, 2 montant, 3 contrepartie, 4 horodatage,
  5 unicité de l'identifiant sur tout le réseau, 6 auto-cohérence de
  l'identifiant (Orange seulement, voir plus bas), 7 contre-signature —, publie
  un reçu portant l'identifiant, et l'acheteuse contresigne d'un tap sur la page
  de suivi qu'elle consulte déjà. **Cette numérotation fait foi** : `AGENTS.md`
  et `docs/formats-sms-operateurs.md` l'emploient à l'identique, et les clés du
  journal d'observabilité en dépendent.
- **Monétisation** : abonnement. **Aucune commission** — on ne peut pas
  prélever sur un flux qu'on ne détient pas.

## Pourquoi cela tient

L'objection à l'approche directe était l'absence de preuve. Elle tombe pour
trois raisons.

D'abord, **le SMS porte un identifiant vérifiable par n'importe qui** auprès de
MTN — au `*126#`, sur le portail MoMo, en agence. Catalog n'a pas besoin d'être
le vérificateur : il lui suffit de rendre la vérification possible.

Ensuite, **la fraude dominante disparaît structurellement**. L'arnaque courante
est l'acheteur qui envoie une fausse capture pour se faire expédier la
marchandise. Ici sa capture ne vaut rien : seul compte le SMS que la vendeuse
lit sur son propre téléphone. La personne qui apporte la preuve est celle dont
l'argent est en jeu.

Enfin, **la contre-signature met deux parties indépendantes sur le même
identifiant**. Falsifier exige la complicité de quelqu'un qui n'a rien à y
gagner, pour une vraie transaction avec ses frais, contre une étoile.

### Le contrôle n° 6, chez Orange

La capture Orange du 29/07/2026 a établi un point que je n'attendais pas :
**l'identifiant Orange n'est pas opaque, il porte sa propre date et son heure.**

```
RC 241204 . 1533 . B00001
││  └date┘   └h m┘   └séquence┘
└ type d'opération (RC rechargement, MP paiement marchand, …)
```

Les onze chiffres de MTN (`17600000001`) ne disent rien d'eux-mêmes et ne
peuvent donc pas se contredire. Un identifiant Orange, si : on le confronte à
l'horodatage annoncé dans le message, et `MP269932.1403.C73941` tombe — le
mois 99 n'existe pas. C'est le **contrôle n° 6, gratuit**, propre à Orange.
Pour un faussaire la charge change de nature : rendre cohérente une heure dont
il ignore qu'elle est inscrite dans l'identifiant.

Deux acquis annexes de la même capture. **Orange écrit aussi en anglais** — le
message de réception commence par « You have received » ; dans un pays bilingue
c'était prévisible, encore fallait-il le voir. Et **les soldes Orange portent
des décimales** (`108762.45 FCFA`) alors que le franc CFA n'a pas de
subdivision : tout montant lu chez Orange est ramené à l'entier avant d'entrer
dans le système, conformément à la règle des montants entiers.

Enfin, une correction de méthode que la capture MTN de réception avait déjà
imposée : le SMS d'**émission** nomme le destinataire, celui de **réception**
nomme l'expéditeur. Le contrôle de contrepartie doit donc comparer au numéro
d'encaissement dans un cas, au numéro de l'acheteuse dans l'autre. Les
confondre rejetterait tous les paiements légitimes.

Ce n'est pas une preuve cryptographique, et il faut le dire. Mais elle est
strictement meilleure que ce que l'agrégateur proposait — dont la signature,
elle, n'atteste rien du tout.

## Conséquences sur le plan

- **La phase 0 disparaît.** Sans agrégateur, il n'y a ni question d'agrément,
  ni négociation commerciale, ni dépendance à un tiers menacé par la réforme
  CEMAC de 2027.
- **La phase paiement se réduit fortement** — celle qui porte les lots 7 à 10
  dans la nouvelle numérotation de `PROMPTS.md`, et non le catalogue : un
  générateur de liens, un analyseur de SMS, les contrôles, une page de
  vérification publique. Plus de webhook, plus
  de réconciliation avec un tiers, plus de machine à états de paiement à
  synchroniser. Quelques jours au lieu de quatre semaines.
- **Le produit change de nature** : ce n'est plus un outil de paiement, c'est
  un **outil de gestion des ventes** — catalogue, commandes, fichier clients,
  réputation. C'est aussi la douleur quotidienne réelle des vendeuses.
- **Le verrou reste la réputation**, désormais adossée à des preuves que
  n'importe qui peut contrôler.

## Ce qui reste à établir — deux tests de terrain

1. **Le format du SMS de réception chez Orange.** Chez MTN, c'est acquis :
   capture du 23/06/2026, analyseur écrit et testé. Chez Orange, la capture du
   29/07/2026 est **tronquée** — on n'a que l'amorce « You have received 650
   FCFA of… ». L'analyseur existe mais tourne sur un texte reconstitué ; il est
   marqué « à confirmer » dans l'interface et le verdict passe en « accepté sous
   réserve ». Ce qui manque : le texte entier d'un message reçu par quelqu'un
   qui vient d'être payé en Orange Money. Un déroulement vers le bas.
2. **Les raccourcis USSD paramétrés.** Les codes d'entrée sont confirmés ; ce
   qui reste à savoir, c'est si une chaîne complète saute les niveaux de menu.
   La rampe est déjà l'instrument de ce test.

Aucun des deux ne bloque le développement du catalogue ni des commandes.

## À revoir si

- Le statut d'**initiateur de paiement** de la réforme CEMAC entre en vigueur
  au 1ᵉʳ janvier 2027 : il ouvrirait une voie propre et régulée.
- Un agrégateur garantit par écrit **à la fois** un modèle sous-marchand
  **et** le renseignement de `operator_reference` sur les transactions
  abouties. Les deux, pas l'un ou l'autre.
- Le volume rend le collage manuel du SMS coûteux pour les vendeuses. C'est un
  signal de succès, pas un problème de conception — et il se traitera à ce
  moment-là, avec du volume et des données en main pour négocier.
