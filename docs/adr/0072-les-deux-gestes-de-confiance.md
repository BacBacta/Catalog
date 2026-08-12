# 0072 — Les deux gestes de confiance

Date : 2026-08-11
Statut : accepté
Met en œuvre : 0061 (deux comptoirs, un moteur), rang 2
Écart de méthode : voir la dernière section

## Contexte

L'ADR 0061 range en quatre le travail qui recoud les deux ères du produit. Les
rangs 0 et 1 sont faits. Le rang 2 rassemble deux gestes qui n'ont rien en
commun sauf ceci : **chacun protège quelqu'un, et chacun coûte presque rien.**

## a) La réputation au moment du doute

### Le problème

Une acheteuse s'apprête à envoyer 3 750 F d'acompte à quelqu'un qu'elle ne
connaît pas. Catalog **ne peut pas** la rassurer par un séquestre : les fonds ne
transitent jamais par un compte à nous, et c'est ce qui définit le produit
(AGENTS.md §2, ADR 0009). Ce n'est pas une limite qu'on lèvera un jour, c'est
la nature du produit.

Il reste un seul levier, et il est honnête : **montrer ce que cette boutique a
déjà prouvé, à l'instant précis où la question se pose.** Les compteurs
existaient depuis le lot 12. Ce qui manquait n'était pas la donnée — c'était le
moment.

### La décision

Le bloc paiement du fil porte une ligne de plus, en dernier, juste avant le
geste :

> 🔒 Cette boutique a 47 paiements prouvés et 12 avis vérifiés. Vérifiez
> vous-même : *lien*

### Le zéro est une INFORMATION, pas un vide

C'est le point qui a demandé le plus de réflexion, parce qu'il **contredit une
règle déjà écrite**.

À l'accueil, la ligne de réputation se tait quand le compteur vaut zéro : « on
ne fait pas dire *0 vente* à une vendeuse qui débute » (commentaire de
`BoutiqueBot.reputation`). Devant une vitrine, c'est le bon choix.

**Au moment de payer, non.** Le silence s'y lit « boutique établie » — c'est le
sens que lui donne l'acheteuse, pas celui qu'on voulait. On dit donc :

> 🆕 Cette boutique débute sur Catalog : aucun paiement n'y est encore prouvé.

Ce n'est pas la même phrase que « 0 vente ». L'une informe, l'autre humilie. La
règle de l'accueil reste vraie chez elle : les deux moments ne posent pas la
même question.

### Trois choix plus petits, mais tenus par des tests

- **Le seuil est UN seul paiement prouvé.** Plus haut paraîtrait prudent et
  serait pire : il ferait passer pour débutantes des boutiques qui ont déjà
  prouvé quelque chose. La phrase porte le nombre ; c'est à l'acheteuse d'en
  juger.
- **Ni `declare_non_trace` ni les commandes créées n'entrent dans le compte.**
  Seuls `prouve` et `contresigne`. Compter le dépôt direct non tracé
  transformerait un compteur de preuves en compteur de ventes — exactement le
  chiffre invérifiable que le produit refuse.
- **La ligne n'apparaît que s'il y a un acompte à payer.** Sans paiement
  attendu, il n'y a pas de doute à lever, et une information servie hors de son
  moment est du bruit.

Aucun jugement n'est écrit : ni « fiable », ni « recommandé ». Un test le
vérifie mot par mot.

## b) L'alerte à l'ancien numéro

### Le problème

**Le téléphone EST le fonds de commerce, et il se vole.** Celui qui le tient
tient le fil WhatsApp, donc le compte, donc — en une manipulation — le numéro
sur lequel les acheteuses paient. Le journal d'audit voyait déjà chaque
changement de reversement. Il ne prévenait personne.

### La décision

Quand le numéro de reversement change, **l'ancien numéro l'apprend**, par SMS.
La double SIM étant la norme (AGENTS.md §2), la vraie propriétaire tient encore
l'autre puce — c'est la seule voie qui ne passe pas par l'appareil volé.

> Catalog : le numéro Mobile Money de votre boutique vient d'être changé.
> Si ce n'est pas vous, envoyez STOP sur WhatsApp au *numéro du bot*.

Trois contraintes sur ce texte, et chacune a coûté une réflexion :

1. **il ne nomme pas le nouveau numéro** — le republier vers une puce dont on
   ne sait pas qui la tient serait offrir la cible ;
2. **il dit où répondre**, parce que le SMS *entrant* n'existe pas chez nous
   (AGENTS.md §9) : le STOP se donne sur WhatsApp ;
3. **il tient en un SMS**, lu sur un vieil appareil, en français simple.

### La première pose ne déclenche rien

Aucun ancien numéro n'existe, donc aucune destinataire légitime. Alerter le
numéro de *connexion* serait tentant et faux : sur un appareil volé, il est déjà
entre les mains du voleur, et l'alerte lui apprendrait seulement qu'un
garde-fou existe.

### Le STOP ne vaut que s'il répond à une alerte

Sans cette condition, un désabonnement ou une faute de frappe gèlerait le
reversement d'une vendeuse qui n'a rien demandé. La fenêtre est de **sept
jours** : une vendeuse dont le téléphone a été volé ne s'en aperçoit pas
toujours le jour même, et la puce de secours n'est pas forcément dans un
appareil allumé.

Le STOP est reconnu **avant l'aiguillage**, et c'est nécessaire : il vient de
l'ancien numéro de reversement, qui n'est presque jamais le numéro de connexion
— l'aiguillage le prendrait pour une acheteuse et lui répondrait un catalogue.

### Ce que le gel fait, et les deux choses qu'il refuse de faire

Il **efface le numéro de reversement** et interdit d'en poser un nouveau
jusqu'à intervention humaine — y compris par quelqu'un qui détient l'appareil et
sait recevoir un OTP. C'est tout l'intérêt du geste : **l'OTP prouve qu'on tient
une puce, pas qu'on est la propriétaire.**

1. **Il ne revient PAS à l'ancien numéro.** Ce serait diriger l'argent vers une
   puce dont on ne sait pas qui la tient aujourd'hui — on sait seulement que
   quelqu'un la tenait à l'instant du STOP. Dans le doute, on arrête l'argent,
   on ne le redirige pas.
2. **Il ne ferme PAS la boutique.** Les commandes en cours vont à leur terme, la
   page reste en ligne, la vendeuse reste joignable. Fermer punirait la victime
   pour un vol qu'elle subit. Sans reversement posé, le bot sait déjà faire : on
   commande, on ne paie pas d'avance.

Ce que voit une acheteuse : une boutique qui ne prend plus d'acompte. Ce que
voit un voleur : un compte qui ne rapporte rien.

### Les messages ne disent jamais « vol »

Ni l'accusé de réception du STOP, ni le refus de changement. Si c'est le voleur
qui lit, il apprendrait ce qui se passe et par où passer. On dit qu'un humain
doit intervenir, et rien de plus.

## Conséquences

- Une colonne additive et nullable, `seller.reversement_gele_depuis` — phase
  *expand* (AGENTS.md §6). `NULL` est l'écrasante majorité.
- L'alerte part **après** la transaction : le changement est acquis, l'alerte
  est un plus. Une passerelle SMS injoignable ne défait pas une opération que la
  vendeuse a menée correctement — même leçon que l'ADR 0065.
- Le signal vit dans le **journal d'audit**, en ajout seul : c'est l'index dont
  le STOP a besoin, et il ne peut pas être vidé.
- Un refus HTTP nouveau : `423 Locked`. Ni une erreur de saisie, ni un droit
  manquant — un verrou.
- 22 tests nouveaux, dont ceux qui interdisent le jugement dans la copie et
  ceux qui vérifient que le gel ne touche ni au statut de la boutique, ni aux
  congés, ni aux commandes.

## L'écart de méthode, dit franchement

`AGENTS.md` §7.1 impose **un lot par session**. Cette session en a reçu deux —
les rangs 2 et 3 — sur demande explicite du porteur du produit, prévenu de la
règle et de son motif.

**Le rang 3 n'a pas été commencé.** Le rang 2 est livré entier, éprouvé et
documenté ; le rang 3 reste ouvert dans son état d'avant. C'est exactement ce
que §7.1 prédit — « un agent qui reçoit trois lots en livre trois moitiés » — à
ceci près qu'on a choisi une moitié entière plutôt que deux moitiés. L'ordre
n'était pas arbitraire : des cinq chantiers des deux rangs, le 2b est le seul
dont l'absence coûte de l'argent réel à une vendeuse.
