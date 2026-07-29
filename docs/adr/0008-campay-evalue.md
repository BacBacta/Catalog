# 0008 — CamPay : évaluation de l'API et adaptateur écrit

- Statut : **évalué, non retenu en l'état** — adaptateur écrit et testé
- Date : 2026-07-29
- Révisé le 2026-07-29 : voir « Troisième passe » en fin de document. Les
  questions 2 et 3 ont reçu une réponse mesurée en bac à sable. Le texte
  antérieur est conservé tel quel — deux de ses affirmations sont désormais
  fausses, et la section finale dit lesquelles.

## Surface de l'API

Relevée sur le SDK Python officiel (`github.com/CamPay/campay-python-sdk`,
dernière publication janvier 2026) :

| Opération | Endpoint |
|---|---|
| Jeton temporaire | `POST /api/token/` |
| Encaissement | `POST /api/collect/` |
| Reversement | `POST /api/withdraw/` |
| Statut | `GET /api/transaction/{reference}/` |
| Solde | `GET /api/balance/` |
| Page de paiement hébergée | `POST /api/get_payment_link/` |

Authentification par jeton permanent (`Authorization: Token …`) ou temporaire.
Statuts : `PENDING` · `SUCCESSFUL` · `FAILED`. Numéros au format `237XXXXXXXXX`,
sans le `+`. Montants entiers ou chaînes, **décimales refusées** — ce qui
s'accorde avec l'ADR 0004. Environnement de démonstration sur `demo.campay.net`.

## Ce qui est bon

- **API petite et compréhensible.** Six endpoints, sémantique claire, SDK
  lisible. L'intégration se code en une journée.
- **Environnement de démonstration ouvert.** On peut écrire et tester
  l'adaptateur **sans contrat ni engagement** — c'est ce qui a été fait ici.
- **`initCollect` renvoie un `ussd_code`.** Le prestataire indique le code que
  la payeuse peut composer si la notification push n'arrive pas. Cela se marie
  directement avec la rampe de paiement : on peut afficher ce code en repli.
- **Le solde est ventilé par opérateur** (`mtn_balance`, `orange_balance`).
  Utile, et révélateur du fonctionnement : voir ci-dessous.

## Les deux raisons de ne pas le retenir en l'état

**1. Pas de bénéficiaire tiers.** `collect` n'a qu'un champ `from`, aucun champ
de destinataire. Les fonds atterrissent sur le solde du compte marchand, et il
faut un `withdraw` pour les reverser. C'est le modèle « compte marchand
unique » que l'ADR 0006 écarte, puisqu'il ferait détenir des fonds à Swap.

**2. La référence de l'opérateur n'est pas exposée.** Les réponses ne portent
que la référence CamPay, un UUID. La référence qui figure dans le SMS reçu par
la vendeuse — un identifiant à 11 chiffres chez MTN — n'apparaît nulle part.
Conséquence : **la voie agrégateur et la voie SMS produisent deux identifiants
sans lien**, et l'on perd le rapprochement élégant entre les deux mécanismes de
preuve. Le repli serait un rapprochement par montant + numéro + horodatage,
moins fiable.

## Ce qui a été produit malgré tout

`apps/api/src/adapters/campay.ts` — adaptateur complet de l'interface
`PaymentProvider`, couvert par 21 tests. Il n'est pas branché en production,
mais il sert trois choses :

- il **valide l'interface** `PaymentProvider` contre un prestataire réel ;
- il fournit un **banc d'essai** utilisable dès aujourd'hui sur `demo.campay.net` ;
- il **documente** dans le code même les deux limites ci-dessus, à l'endroit
  où quelqu'un les redécouvrirait.

Deux décisions de sécurité y sont figées : `PENDING` est projeté sur
`waiting_customer` et **jamais** sur `failed`, et `verifySignature` **refuse
tout ce qui n'est pas signé** — CamPay ne documentant pas publiquement de
signature de webhook, on ne laisse pas de laissez-passer en attendant.

## Seconde passe : ce que la documentation ne dit pas

Sources épuisées le 29/07/2026 : SDK Python (README + source), SDK Android
(README), wrapper PHP communautaire (README + source), documentation Postman
(deux lectures), page du plugin WooCommerce. `campay.net` renvoie un 403 et
`demo.campay.net` comme le navigateur de sources WordPress sont fermés à la
consultation automatisée.

**Trouvé en seconde passe :**

- Un **septième endpoint non documenté publiquement** : `POST /api/history/`
  avec `start_date` / `end_date`, relevé dans le wrapper PHP et absent du SDK
  Python. C'est **le seul endroit où la référence de l'opérateur pourrait
  apparaître** — à vérifier en priorité en bac à sable.
- Les **codes d'erreur** : `ER101` numéro invalide, `ER102` opérateur non
  supporté (MTN et Orange seulement), `ER201` montant décimal refusé,
  `ER301` solde insuffisant au reversement. Le dernier est le cas
  « flottant épuisé » : il est **réessayable**, les autres non. L'adaptateur
  les traduit désormais en erreurs typées.
- Le plugin WooCommerce mentionne l'ajout d'un **webhook en version 1.2.1
  (mars 2025)** — donc les webhooks existent, mais ni leur charge utile ni
  leur éventuelle signature ne sont documentées publiquement.

**Reste inconnu, et ne se lèvera pas en ligne :** structure exacte de la charge
utile des webhooks, existence et schéma d'une signature, plafonds de montant,
délai de reversement, et forme de la réponse de `/api/history/`.

**Comment fermer ces trous :** créer une application sur `demo.campay.net`.
C'est gratuit, immédiat, sans engagement, et l'interface de configuration des
webhooks montrera la charge utile et la présence ou non d'une signature.
L'adaptateur de ce dépôt est déjà prêt à être branché dessus.

## Questions à poser à CamPay par écrit

1. Existe-t-il un modèle **sous-marchand** où le vendeur est enregistré comme
   bénéficiaire avec son propre numéro, sans transit par un compte à notre nom ?
2. La **référence de transaction de l'opérateur** est-elle disponible dans le
   webhook, ou dans un champ étendu de la réponse de statut ?
3. Les webhooks sont-ils **signés** ? Selon quel schéma, avec quel en-tête ?
4. Le reversement est-il **instantané** ou groupé ?
5. Que se passe-t-il quand le **solde d'un opérateur tombe à zéro** — les
   reversements échouent-ils silencieusement, et existe-t-il une alerte ?
6. Grille tarifaire contractuelle, et plan de conformité au statut d'Opérateur
   de Services de Paiement au 1ᵉʳ janvier 2027.

## À revoir si

Une réponse favorable à la question 1 ou 2 change l'évaluation. La question 2
suffirait à elle seule à rendre CamPay nettement plus intéressant que ses
concurrents, puisqu'elle réconcilierait les deux voies de preuve.

---

## Troisième passe : mesures en bac à sable (29/07/2026)

Une application de démonstration a été créée sur `demo.campay.net` et
interrogée avec `apps/api/scripts/campay-probe.mjs` et des appels directs.
Tout ce qui suit est **relevé verbatim**, pas déduit d'une documentation.
Les charges utiles servent désormais de fixtures dans `campay.test.ts`.

### Question 2 — la référence de l'opérateur : **OUI, le champ existe**

C'est le point qui bloquait l'évaluation, et la deuxième passe se trompait.

`GET /api/transaction/{ref}/` renvoie un champ `operator_reference`, et il
porte bien la référence de l'opérateur :

| Opérateur | Valeur observée | Correspond au |
|---|---|---|
| MTN | `18132148736` | identifiant à 11 chiffres du SMS MTN |
| Orange | `MP260729.1716.C73941` | format des reçus Orange Money |

`POST /api/history/` expose la même valeur sous le nom `operator_tx_code`.

**Mais la réponse n'est que partiellement favorable, et la nuance est
décisive.** Le champ n'est pas toujours renseigné : les transactions
`SUCCESSFUL` simulées par le bac à sable l'ont laissé **vide** (`""`, jamais
absent), alors qu'une transaction `PENDING` et une transaction `FAILED` le
portaient. Le bac à sable est manifestement synthétique sur ce chemin — ses
succès arrivent aussi avec un montant `0.00`. **On ne peut donc pas encore
conclure que la référence est disponible sur un paiement réellement abouti**,
qui est précisément le seul cas où le rapprochement avec le SMS nous
intéresse. À confirmer par écrit ou sur un compte de production.

L'adaptateur traite la chaîne vide comme une absence et n'en fait aucune
dépendance dure.

### Question 3 — les webhooks sont signés : **OUI, et le schéma est connu**

La réponse de statut contient un champ `signature`. C'est un **JWT HS256**
dont la clé HMAC est la « clé webhook de l'application ». Vérifié octet par
octet sur trois transactions : la signature recalculée correspond exactement.
Aucun en-tête de signature n'a été observé — le jeton voyage **dans le corps**.

**Le résultat le plus important de cette passe est négatif.** La charge utile
du JWT ne contient que :

```json
{"iat":1785342145,"nbf":1785342145,"exp":1785345745,"source":"CamPay"}
```

Ni référence, ni montant, ni statut. **Le jeton ne lie aucune donnée de
transaction.** Deux transactions différentes — montants différents, opérateurs
différents, références différentes — émises dans la même seconde ont produit
un jeton **identique octet pour octet**. C'est donc un porteur rejouable
pendant une heure : quiconque en capture un peut l'agrafer à une charge utile
forgée, et la vérification passera.

Conséquence : une signature valide autorise à dire « CamPay a émis un jeton
récemment », **jamais** « ce paiement a eu lieu ». La règle d'AGENTS.md — le
webhook n'est jamais une preuve, on re-vérifie toujours par `checkStatus` —
n'est pas ici une précaution de principe : c'est la seule chose qui tient.
Un test gèle explicitement cette propriété pour que personne ne construise
dessus.

### Question 1 — sous-marchand : **toujours non**

Confirmé, pas infirmé. `POST /api/collect/` ne renvoie que trois champs
(`reference`, `ussd_code`, `operator`) et n'accepte aucun champ bénéficiaire.
Le modèle « compte marchand unique » reste celui de CamPay, et l'ADR 0006
continue de l'écarter. **C'est ce point, et non la question 2, qui reste
bloquant.**

### Questions 4, 5 et 6 — sans réponse, et elles ne se lèveront pas ici

- **Délai de reversement** : `POST /api/withdraw/` n'a pas pu être appelé, le
  solde de démonstration étant à zéro. ER301 reste non reproduit.
- **Solde d'opérateur à zéro** : non testable pour la même raison.
- **Grille tarifaire** : l'historique montre une commission de 1 XAF sur des
  transactions de 5 et 10 XAF. C'est un tarif de bac à sable, sans valeur
  contractuelle — à ne pas citer en interne comme un ordre de grandeur.

### Ce que la sonde a trouvé en plus

- **`POST /api/history/` existe** (la deuxième passe le supposait) et répond
  `{ "data": [...] }`. Deux limites qui l'empêchent de servir de journal de
  reprise : les transactions **`PENDING` n'y figurent pas**, et il **n'y a
  aucun champ `external_reference`** — notre référence de commande ne voyage
  pas jusque-là. Le rapprochement ne peut se faire que par `reference_uuid`.
- **Minimum par opérateur** : 5 XAF passent chez MTN ; Orange refuse avec
  `ER201 « Minimum amount for Orange is 10.00 »`. Non documenté ailleurs.
- **Le code USSD dépend de l'opérateur** : `*126#` chez MTN, `#150*50#` chez
  Orange. La rampe de paiement doit afficher celui que renvoie `collect`, pas
  une constante.
- **Le solde porte deux champs de plus** que prévu : `utility_balance` et
  `utility_commission_balance`.
- **`code` n'est pas la référence opérateur.** CamPay expose aussi un
  identifiant interne (`D260729D0053YC`) qu'il serait facile de confondre avec
  elle. Un test l'interdit.
- **Les montants changent de type selon l'endpoint** : chaîne décimale
  (`"5.00"`) sur le statut, nombre (`5.0`) sur l'historique. L'adaptateur
  refuse désormais bruyamment toute partie décimale non nulle plutôt que
  d'arrondir en silence — le FCFA n'a pas de sous-unité (ADR 0004).
- **Codes d'erreur réels** : `ER101 « Invalid phone number »`, `ER201`
  (décimale, zéro, ou sous le minimum). `ER102` et `ER301` n'ont pas pu être
  déclenchés et restent hérités du wrapper PHP.

### Ce qui reste inconnu

**La forme exacte du corps du webhook n'a pas pu être relevée.** Elle exige
de coller une URL publique dans le tableau de bord CamPay — or l'accès obtenu
est celui de l'API, pas celui du tableau de bord, et `POST /api/collect/`
ignore silencieusement tout paramètre de type `webhook_url` / `callback_url` /
`notification_url`. Le capteur `webhook-capture.mjs` a été vérifié et
fonctionne ; il ne manque que la configuration côté CamPay.

Le schéma de signature, lui, est connu et implémenté : le champ `signature`
n'a aucune utilité dans une réponse déjà authentifiée en TLS, sa seule raison
d'être est d'accompagner une notification poussée. La vérification échoue de
toute façon en silence si le corps réel diffère — rien n'avance sans elle.

### Effet sur la décision

La question 2 était présentée comme suffisante à elle seule pour rendre CamPay
« nettement plus intéressant ». Après mesure, elle est **partiellement**
favorable : le champ existe et porte le bon identifiant, mais son
renseignement sur un paiement abouti n'est pas établi. Cela ne suffit pas à
retourner l'évaluation, parce que **la question 1 reste bloquante** — c'est
elle, et non la référence opérateur, qui décide de la compatibilité avec
l'ADR 0006.

Le statut reste donc **évalué, non retenu en l'état**. Les questions à poser
par écrit se réduisent à trois : le modèle sous-marchand (1), le
renseignement de `operator_reference` sur un `SUCCESSFUL` en production (2b),
et le délai de reversement (4).
