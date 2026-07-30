# 0019 — Les analyseurs de SMS : un trou trouvé dans la spécification, et trois décisions

- Statut : accepté
- Date : 2026-07-30
- Concerne le lot 8 (`apps/api/src/domain/proof`, `apps/api/src/routes`, `apps/seller`)
- N'ajoute aucune dépendance
- **Amende `docs/formats-sms-operateurs.md` §4** sur un point : `xafInt`

## Contexte

Le lot 8 transpose `docs/formats-sms-operateurs.md` en TypeScript : cinq motifs
de SMS, sept contrôles, et l'écran où la vendeuse colle son message.

Ce fichier-là est une **spécification**, pas de la documentation. Ses expressions
ont été écrites contre des messages réels et vérifiées contre eux : elles se
copient, on ne les réécrit pas. La transposition est donc littérale — seuls les
types sont explicites. Une seule exception, ci-dessous, et elle a une raison.

## Le trou — `Number("")` vaut zéro, pas NaN

`xafInt` de la spécification lève sur un montant illisible, avec le bon
raisonnement écrit à côté : « mieux vaut un refus qu'un NaN dans une colonne
Int ». La mise en œuvre repose sur `Number.isFinite`.

Or `Number("")` vaut **zéro**, et zéro est fini.

Le motif `om.entrant` capture le montant avec `([\d\s.,]+?)` — chiffres, espaces,
points **et virgules**. Un montant fait uniquement de séparateurs satisfait donc
le motif, traverse `xafInt`, et ressort à zéro. Mesuré :

```
You have received  ,  FCFA of 237677000001, ID transaction: MP260623.1403.C73941, Frais: 0 FCFA
```

est reconnu, avec un identifiant Orange **valide**, une contrepartie **correcte**,
et un montant de **zéro franc**. Un faux paiement parfaitement formé, qui aurait
échoué au seul contrôle n° 2 — et qui l'aurait passé sur une commande à zéro.

**Décision : `xafInt` exige au moins un chiffre.** C'est un écart par rapport à la
lettre de la spécification, au service de son intention déclarée. Le fichier de
spécification doit être amendé au prochain passage : il est la source, le code en
découle.

Deuxième correction du même geste : **le message d'erreur ne porte plus le
montant**. `montant illisible: ${s}` remonterait dans une trace, et un fragment
de SMS y entraînerait le solde du compte de la vendeuse.

## Décision 1 — le contrôle n° 6 est ABSENT chez MTN, pas « réussi »

`decodeOrangeId` rend `null` sur un identifiant non-Orange. La question est ce
qu'on en fait : un contrôle réussi, un contrôle ignoré, ou pas de contrôle du
tout.

Les onze chiffres de MTN sont **opaques** : ils ne disent rien d'eux-mêmes, donc
ils ne peuvent pas se contredire. Un « contrôle réussi » affirmerait qu'une
vérification a eu lieu — elle n'a pas eu lieu, elle n'a pas de sens. La liste de
contrôles rendue chez MTN compte donc **six entrées**, numérotées 1, 2, 3, 4, 5,
7, et l'écran affiche « sans objet » sur la sixième plutôt que de la laisser en
attente indéfinie, ce qui ressemblerait à une vérification bloquée.

## Décision 2 — un `fail` parmi les six contrôles purs n'écrit RIEN

La séquence de la spécification est : six contrôles purs, puis INSERT si aucun
`fail`. Reste à décider ce qu'on fait d'un SMS refusé.

**On n'écrit pas.** Enregistrer une preuve refusée réserverait l'identifiant dans
la contrainte `UNIQUE(operator, operator_tx_id)`, et la vraie preuve — celle qui
arriverait après correction de la commande, par exemple — serait alors refusée par
le contrôle n° 5 pour un identifiant que le système s'est réservé à lui-même. Un
test le fixe.

Corollaire : une preuve refusée ne laisse pas de trace en base. C'est un choix de
v1 ; le jour où l'on voudra compter les tentatives, il faudra une table distincte
et non un assouplissement de celle-ci.

## Décision 3 — le SMS brut est chiffré, et il ne redescend jamais

Le SMS porte « Votre nouveau solde: 12020 XAF ». Ce n'est pas une donnée de
paiement, c'est la **situation financière** de la vendeuse. Une sauvegarde de base
qui fuit exposerait le solde de chaque vendeuse du service.

On le conserve quand même — c'est la pièce qui permet de rejouer l'analyse le jour
où un motif change, et de trancher un litige ; le supprimer rendrait toute
contestation ininstruisible — mais **chiffré au repos**, en AES-256-GCM.

GCM et non CBC : GCM **authentifie**. Sans authentification, un texte chiffré
modifié se déchiffre en données quelconques, et l'analyse repartirait sur un
message fabriqué. Un test altère quatre caractères et vérifie que le déchiffrement
échoue.

Format `v1.<sel>.<nonce>.<étiquette>.<chiffré>` : le préfixe de version permettra
de changer d'algorithme sans deviner comment les anciennes lignes ont été écrites.

Quatre conséquences vérifiées par des tests :

- le SMS n'apparaît **dans aucun log** — les cinq méthodes de `console` sont
  espionnées sur les trois chemins : accepté, refusé, non reconnu ;
- il n'apparaît **dans aucune réponse HTTP**, y compris les réponses d'erreur ;
- l'écran **vide le champ** dès qu'une réponse arrive ;
- `payment_proof` n'a **aucune colonne de solde**, et un test interroge
  `information_schema` pour le vérifier — c'est le genre de colonne qu'on ajoute
  « pour le diagnostic ».

`ChiffreurInerte` refuse de se construire en production, comme `ConsoleSmsSender`
et `MemoryStorage` avant lui. Un oubli de configuration devient une panne
immédiate et lisible plutôt qu'une fuite différée.

## Ce que les tests verrouillent, et pourquoi

**L'ordre des motifs.** Les cinq sont aujourd'hui mutuellement exclusifs, donc
l'ordre n'a aucun effet observable. Le test existe pour le jour où un sixième
s'ajoutera — le SMS Orange d'envoi : rien ne garantit qu'il restera disjoint. Le
test verrouille l'appariement de chaque fixture, de sorte qu'un motif trop large
fasse échouer la CI au lieu d'intercepter silencieusement les messages d'un autre.

**Le contrôle 3 comparé aux deux références.** Un test prend le même SMS sortant
et le confronte une fois au reversement de la vendeuse (`pass`), une fois au
numéro de l'acheteuse (`fail`). C'est l'erreur que la spécification signale comme
la plus facile à commettre — elle rejetterait *tous* les paiements légitimes — et
ce test la rend impossible à réintroduire sans la voir.

**Un motif `aConfirmer` ne peut jamais produire « accepté ».** Le test met tous
les autres contrôles au vert, y compris la contre-signature, et vérifie que le
verdict plafonne à « accepté sous réserve » — avant **et** après consultation de
la base. Le drapeau n'est pas un commentaire.

**Aucun `g` sur les motifs.** `RegExp.prototype.test` avec le drapeau global
avance `lastIndex` : deux appels de suite sur le même motif donnent des résultats
différents. Un test le vérifie sur les cinq.

**Le fuseau.** Un test échoue explicitement si
`Intl.DateTimeFormat().resolvedOptions().timeZone` n'est pas `Africa/Douala`.
Sans ce réglage, `new Date(y, m, d, …)` construit dans le fuseau du processus et
la fenêtre de 48 h du contrôle n° 4 dérive d'une heure — le test passe en local et
échoue en CI.

## Le contrôle n° 5, et ce qui prouve qu'il est bien réseau-large

Deux tests contre une vraie base :

1. **deux vendeuses différentes**, deux commandes différentes, le même
   identifiant : la seconde est refusée en 409, avec le contrôle n° 5 en `fail` ;
2. **une seule ligne existe** en base pour cet identifiant. C'est la preuve que la
   contrainte a tranché : un SELECT suivi d'un `if` en aurait laissé passer deux à
   la même seconde.

Un troisième interroge `pg_indexes` et vérifie que la contrainte porte bien sur
`(operator, operator_tx_id)` — pas sur l'identifiant seul, pas sur la commande.

## L'écran, et le bandeau qui ne se ferme pas

Le bandeau « Ne vous fiez jamais à une capture d'écran. Seul votre propre SMS
compte » est **au-dessus du champ**, permanent, non refermable. Une capture ne
porte aucun identifiant contrôlable ; c'est l'arnaque la plus courante du marché,
et l'interface doit le dire avant qu'on la subisse.

Les sept contrôles sont affichés **dès l'ouverture**, en attente, avec ce que
chacun va vérifier. Une vendeuse qui voit d'avance ce qui sera contrôlé comprend
un refus au lieu de le subir — et une vendeuse qui ne comprend pas un refus expédie
quand même, ce qui annulerait tout l'intérêt du produit.

Le test de bout en bout simule la réponse de l'API par `page.route`. Ce n'est pas
un raccourci : le serveur est couvert par dix-neuf tests contre une vraie base, et
ce que mesure ce test — axe-core sur l'écran rendu, un vrai `Ctrl+V` — ne dépend
pas de lui. Créer une commande demanderait les routes du lot 11.

## Ce qui reste à demander au terrain

Inchangé depuis la spécification §7, et toujours non bloquant :

1. **le SMS Orange de réception, en entier.** Tant qu'il manque, `om.entrant`
   reste `aConfirmer` et son verdict plafonne ;
2. **le SMS Orange d'envoi.** Aucune capture. Le motif n'existe pas et ne doit pas
   être inventé.

Quand une capture arrive : mettre à jour `docs/formats-sms-operateurs.md`
**d'abord**, puis le code, puis les fixtures.
