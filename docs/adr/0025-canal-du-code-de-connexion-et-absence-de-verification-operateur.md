# ADR 0025 — Le canal du code de connexion, un garde-fou reporté, et l'absence de vérification chez les opérateurs

- **Statut** : accepté
- **Date** : 31/07/2026
- **Lot** : aucun — décisions prises après le lot 15, en préparant la mise en ligne
- **Concerne** : `apps/api/src/adapters/sms-orange.ts`, `apps/api/src/adapters/sms-whatsapp.ts`,
  `apps/api/src/adapters/sms-provider.ts`, `apps/api/src/domain/sms/livraison.ts`,
  `apps/api/src/routes/accuse-livraison.ts`, `apps/api/src/auth.ts`,
  `docs/runbooks/checklist-lancement.md` §4
- **Révise** : rien. **Complète** les ADR 0008 et 0009 par un constat qu'ils
  n'avaient pas les moyens d'établir.

## Contexte

Le lot 15 a livré une application déployable dont **aucune vendeuse ne pouvait
franchir le premier écran**. `PendingSmsProvider.send()` lève, délibérément :
son en-tête énumère trois décisions qu'il fallait prendre avant de le remplir —
le fournisseur, l'identifiant d'expéditeur déclaré au régulateur, et le
comportement en cas d'échec partiel.

Ce n'était pas un oubli mais une limite : aucun nom de passerelle n'était écrit
dans le dépôt, et lever valait mieux qu'un envoi qu'on croit parti. Une vendeuse
devant un champ OTP qui ne se remplira jamais est un pire défaut qu'une erreur
au démarrage.

Cet ADR consigne ce qui a été tranché ensuite, y compris **un écart assumé à une
contrainte non négociable d'AGENTS.md**, et un constat qui ferme une question
restée ouverte depuis l'investigation agrégateur.

---

## Décision 1 — le code de connexion reste en V1

Il aurait été possible de s'en passer : la vendeuse est déjà sur WhatsApp, et
une authentification par lien magique dans une conversation existante est
concevable.

Elle est écartée. Le numéro de téléphone est **la clé d'identité du produit** —
c'est lui qui relie une boutique, un catalogue, des commandes et un historique
de preuves. Un compte dont le numéro n'a jamais été vérifié est un compte que
n'importe qui peut revendiquer, et le jour où il faut arbitrer entre deux
personnes réclamant la même boutique, il n'existe aucune trace pour trancher.

---

## Décision 2 — WhatsApp est un canal acceptable pour ce code

AGENTS.md et le code disent « SMS » partout. Le canal réel n'a jamais été la
contrainte : **ce qui compte est qu'un secret à usage unique atteigne le
détenteur du numéro.** Un message WhatsApp vers ce même numéro satisfait cette
propriété.

Ce que le choix apporte, concrètement : pas de démarche auprès du régulateur
pour un identifiant d'expéditeur, pas de coût au message, et une remise
observable — Meta rapporte les statuts, là où une passerelle SMS répond 200 et
se tait.

Ce qu'il coûte, et qui n'est pas rien : **WhatsApp exige de la donnée mobile.**
Un forfait épuisé — situation banale, et corrélée avec le fait d'avoir besoin de
vendre — rend le canal muet, alors qu'un SMS entrant arrive toujours et ne coûte
rien à la destinataire. C'est la raison pour laquelle l'adaptateur Orange est
écrit et testé lui aussi, et pour laquelle le choix est **une variable
d'environnement, pas une réécriture**.

---

## Décision 3 — le garde-fou du numéro de reversement est REPORTÉ

**C'est l'écart de cet ADR, et il porte sur une contrainte non négociable.**

AGENTS.md §2 est explicite :

> Le numéro de reversement est un champ distinct du numéro de connexion, vérifié
> par son propre OTP. La double SIM est la norme […] Toute modification de ce
> numéro exige une nouvelle vérification — **c'est le champ qu'un attaquant
> chercherait à détourner.**

Le raisonnement d'origine tient en une phrase : le code doit arriver **sur la
puce qu'on veut vérifier**. Une vendeuse se connecte sur sa puce MTN, où vit
WhatsApp, et encaisse sur sa puce Orange, qui ne reçoit que des SMS. Envoyer le
code de reversement par WhatsApp le fait arriver sur la puce de connexion : on
vérifie la mauvaise carte.

Ce garde-fou a été **reporté à une version ultérieure par le porteur du
produit**, au motif que le risque est peu prégnant dans l'environnement
camerounais. La décision lui appartient ; l'objection a été formulée avant, et
elle est maintenue ici — c'est la fonction d'un ADR.

**Voici ce que le report ouvre exactement.** Quand `SMS_PROVIDER=whatsapp`, les
deux OTP empruntent le même canal et arrivent au même endroit. Quelqu'un qui a
la session WhatsApp de la vendeuse sous les yeux — téléphone déverrouillé,
WhatsApp Web resté ouvert, puce clonée — peut donc remplacer le numéro de
reversement par le sien : le code de confirmation atterrit dans la conversation
qu'il regarde déjà. **Toutes les ventes suivantes sont encaissées ailleurs**, et
rien dans le produit ne le signale, puisque la vérification a formellement eu
lieu.

Ce n'est pas un défaut de mise en œuvre : le flux OTP de reversement existe
toujours et fonctionne. Ce qui disparaît est ce qu'il **prouve**. Il atteste que
la personne contrôle le compte, plus qu'elle contrôle le numéro qu'elle
déclare.

Trois choses limitent la portée du report, et aucune ne l'annule :

- l'attaque exige un accès au téléphone ou à la session, pas seulement la
  connaissance d'un numéro ;
- le changement de numéro de reversement écrit dans le journal d'audit en ajout
  seul — l'événement est reconstituable après coup ;
- **avec `SMS_PROVIDER=orange`, le garde-fou est intact.** Le report est une
  propriété du canal choisi, pas une suppression de code.

Ce qui le refermera, le jour venu : router le seul `otp_reversement` vers un
canal SMS, indépendamment du canal de connexion. L'interface `SmsSender` le
permet sans toucher au domaine — c'est un aiguillage dans
`smsSenderDepuisEnv`, pas une migration.

> **La ligne qui n'a pas bougé.** Ce report touche la vérification d'un numéro.
> Il ne touche **ni la preuve de paiement, ni les sept contrôles, ni l'invariant
> des fonds** : Catalog continue de n'encaisser jamais, et un identifiant
> d'opérateur ne vaut toujours qu'une fois sur tout le réseau.

---

## Décision 4 — deux adaptateurs, une interface, et le choix dans une variable

`SMS_PROVIDER` prend quatre valeurs, et c'est le seul endroit du dépôt où un nom
de fournisseur vit :

| valeur | canal | remarque |
|---|---|---|
| `console` | sortie standard | refuse de se charger en production |
| `orange` | SMS, tous opérateurs | API `sms-cm` |
| `whatsapp` | modèle d'authentification | ne porte que les deux OTP |
| `provider` | rien : lève | la place tenue pour une autre passerelle |

**Aucune route, aucun job, aucune règle métier ne sait quel canal est actif.**
C'est ce qui rend le retour en arrière possible en une variable — et c'est aussi
ce qui rend le report de la décision 3 réversible sans réécriture.

Les deux formes de requête sont **recopiées des documentations officielles**,
lues avant d'écrire une ligne. Même discipline que les motifs de SMS du lot 8 :
une forme écrite de mémoire se casse sur un détail qu'on ne reproduit jamais en
test.

---

## Décision 5 — Orange : le jumeau qui ne se referme pas en code

Orange publie deux API aux noms presque identiques, **qui partagent le même
chemin technique** :

| API | Portée annoncée |
|---|---|
| `sms-cm` — « SMS Cameroon » | *« Only in and to Cameroon any operator »* |
| `sms-onnet-cm` — « (Orange Only) » | abonnés Orange seulement |

Il y a donc **deux façons** de se retrouver à n'envoyer qu'en Orange, et le code
n'en couvre qu'une :

1. le paramètre `resource_type_parameter_management=SMS_OCB2` — jamais posé, et
   un test l'interdit nommément ;
2. **la souscription de l'application** dans la console — invisible depuis le
   code.

Le second est le piège. Des identifiants issus de la mauvaise offre enverraient
en Orange seul, l'API répondrait normalement, **tous les tests de ce dépôt
passeraient**, et une vendeuse MTN sur trois ne pourrait jamais se connecter
sans que rien ne le signale.

**Cette porte ne se ferme pas en code.** Elle est en §4.11 de la checklist de
lancement, avec son coût écrit à côté, et non déclarée faite.

---

## Décision 6 — `SmsMessage.valeur` : un gabarit n'est pas une phrase

Meta approuve un **modèle** et attend le **paramètre**, pas le texte fini. D'où
un champ `valeur` optionnel : la valeur brute voyage à côté de la phrase déjà
composée.

L'alternative aurait été de ré-extraire le code par expression régulière depuis
le texte français. Elle est refusée : **un canal ne doit pas dépendre de la
ponctuation d'un autre.** Le jour où la phrase de connexion change de forme,
l'envoi WhatsApp cesserait silencieusement de porter le bon code.

Le champ est optionnel, donc aucun appelant existant n'est cassé — et
l'adaptateur **lève** si la valeur manque, plutôt que d'envoyer « votre code
est » suivi de rien.

---

## Décision 7 — les accusés de livraison mesurent la couverture, ils ne confirment rien

Orange fournit des *Delivery Receipts*. Ils répondent à la troisième décision
laissée ouverte par `sms-provider.ts` — « une passerelle qui accepte le message
puis ne le délivre pas est le cas courant, et il ne se voit pas depuis un code
HTTP 200 ».

Mais leur vraie raison d'être est ailleurs : **ventilés par opérateur, ils sont
le seul contrôle automatique de la décision 5.** Un écart systématique entre les
préfixes MTN et Orange ne s'explique pas par des téléphones éteints — il dit que
la souscription est fausse, et il le dit avant qu'une vendeuse n'ait renoncé.

> **La nuance qui structure le module.** `DeliveryImpossible` **n'est pas une
> preuve de non-livraison** : un téléphone éteint plus de 24 h, un numéro fixe ou
> désaffecté produisent le même statut. Une seule valeur est sûre,
> `DeliveredToTerminal`, et un test verrouille qu'elle soit la seule à porter
> `certain: true`. D'où le nom de l'état `echec_possible`, et la consigne de la
> checklist : **lire l'écart entre opérateurs, jamais le niveau absolu.** Une
> alerte bâtie sur le volume d'échecs sonnerait pour des batteries à plat.

`operateurProbable` porte « probable » dans son nom : la portabilité rend la
déduction fausse au cas par cas. Elle ne sert qu'à la mesure — **aucune règle de
preuve, de paiement ou d'authentification ne la lit.**

**Orange ne signe pas ses rappels.** Le secret vit donc dans le chemin, l'idiome
déjà retenu pour le lien de suivi (ADR 0021). Ce qu'il apporte : un tiers qui
l'ignore ne peut pas fabriquer de fausses mesures. Ce qu'il n'apporte pas : rien
contre une fuite du secret ni contre un rejeu. C'est proportionné parce que **la
route ne touche à rien** — ni base, ni état de commande, ni autorisation. Le
pire qu'un attaquant puisse en faire est de fausser un tableau de bord.

---

## Constat — ni MTN ni Orange n'offre de vérification de transaction par un tiers

Ce point ne décide de rien. Il est écrit ici parce qu'il ferme une question que
les ADR 0008 et 0009 laissaient implicitement au crédit d'un futur agrégateur,
et parce que **le coût de la reposer est de reprendre l'investigation entière.**

Les deux documentations d'API ont été parcourues :

- **MTN MoMo API** expose Collection, Disbursement et Remittance. Toutes sont
  **custodiales** : elles supposent un compte marchand qui détient les fonds —
  exactement ce que l'invariant d'AGENTS.md §2 interdit. Et
  `GET requesttopay/{referenceId}` ne retrouve que les transactions **qu'on a
  soi-même initiées** : la référence est un UUID que l'appelant génère. Il
  n'existe aucun point d'entrée permettant de demander « cette transaction,
  entre ces deux tiers, a-t-elle eu lieu ? ».
- **Orange** publie des API SMS, USSD et Money. La même limite s'y applique :
  consulter une transaction suppose en être partie.

**La conséquence est structurante et vaut d'être dite en une phrase :** il
n'existe, chez aucun des deux opérateurs, de moyen pour un tiers de vérifier un
paiement entre deux personnes. Le SMS reçu par la vendeuse n'est donc pas le
meilleur signal disponible — **c'est le seul.**

Cela renforce l'ADR 0009 par un chemin indépendant. Le lot 8 pariait sur la
preuve par SMS parce que l'agrégateur ne garantissait pas la référence
opérateur ; on sait maintenant qu'aucune API opérateur ne l'aurait offerte non
plus.

Corollaire pratique : **une offre commerciale d'un opérateur qui promet
d'« encaisser » pour le compte du marchand ne sera jamais compatible** avec la
v1, quel que soit son confort d'intégration. Ce n'est pas une préférence — c'est
le premier interdit d'AGENTS.md §8, celui qui ferait basculer le produit dans le
champ de l'agrément (Règlement CEMAC 04/18).

---

## Conséquences

**Ce qui se déverrouille.** Le parcours vendeuse cesse d'être bloqué dès qu'un
compte existe. Le choix du canal se fait, et se défait, par une variable
d'environnement.

**Ce qui s'assombrit.** Avec `SMS_PROVIDER=whatsapp`, la vérification du numéro
de reversement n'atteste plus le contrôle de ce numéro (décision 3). C'est un
report explicite, borné au canal, et réversible par un aiguillage.

**Ce qui ne bouge pas.** Aucun fonds ne transite par Catalog. Aucune commission
n'est calculée. Les sept contrôles et l'unicité réseau-large de l'identifiant
d'opérateur sont inchangés. Le SMS brut n'entre dans aucune trace (ADR 0023).

**Ce qui est mesuré désormais.** `catalog.sms.livraison`, ventilé par opérateur
et par état, dit si les vendeuses MTN reçoivent réellement leur code.

**Ce qu'aucun message d'erreur ne porte** : ni le code, ni le texte, ni le corps
de réponse du fournisseur — celui de Meta recopie la charge utile envoyée, donc
l'OTP. Un OTP dans un journal est un OTP compromis. Trois tests l'affirment.

---

## Ce qui reste ouvert, et qui ne peut pas se fermer en session

| # | Point | Pourquoi |
|---|---|---|
| 1 | La souscription Orange est-elle `sms-cm` ou `sms-onnet-cm` ? | Vérification de compte. Le code ne peut pas la voir — checklist §4.11 |
| 2 | Un code reçu sur un numéro MTN **et** sur un numéro Orange | La première preuve réelle de couverture — §4.12 |
| 3 | Comment l'URL de rappel se déclare chez Orange | Formulaire de liste blanche, ou `receiptRequest` par message. Le second est posé ; si seul le premier vaut, le champ est sans effet et rien ne casse |
| 4 | Les plages de préfixes MTN / Orange / Camtel | Approximatives par construction, portabilité comprise. À confirmer au terrain |
| 5 | Le délai avant de refermer le garde-fou de la décision 3 | Décision de produit, pas de code |

Le point 5 mérite une date plutôt qu'une intention. Un garde-fou reporté sans
échéance est un garde-fou supprimé.
