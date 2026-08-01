# ADR 0026 — MboaSMS comme passerelle de code de connexion, après l'échec mesuré de l'API Orange

- **Statut** : accepté
- **Date** : 01/08/2026
- **Lot** : aucun — décision prise en déployant la préproduction
- **Concerne** : `apps/api/src/adapters/sms-mboa.ts`, `apps/api/src/adapters/sms-orange.ts`,
  `apps/api/src/adapters/sms-provider.ts`, `apps/api/src/auth.ts`, `.env.example`,
  `docs/terrain/orange-sms-contrat.mjs`
- **Complète** l'ADR 0025 : il actait le choix du canal sans qu'aucun compte
  opérateur n'existe. Celui-ci le corrige par la mesure. Il ne révise rien.

## Contexte

L'ADR 0025 a retenu l'API « SMS Cameroon » (`sms-cm`) d'Orange comme canal du
code de connexion, précisément parce qu'elle annonce **tous les opérateurs** :
une intégration, et les vendeuses MTN comme Orange reçoivent leur code.

Le 01/08/2026, un compte Orange Developer réel a été ouvert et l'adaptateur
branché sur la préproduction. **Rien n'est jamais arrivé.**

## Ce que la mesure a établi

Six envois, tous acceptés en **HTTP 201**, aucun remis — ni vers MTN
(`+237683921934`), ni vers Orange (`+237656746215`).

Ce qui a été éliminé, dans l'ordre :

| Hypothèse | Écartée parce que |
|---|---|
| Souscription `sms-onnet-cm` | L'envoi vers un numéro **Orange** n'est pas arrivé non plus |
| Mauvaise adresse d'expéditeur | `tel:+2370000` est ce que génère la console d'Orange **pour ce compte** |
| Nom d'expéditeur non déclaré | Testé avec `CATALOG`, avec `SMS 683800` alloué, et **sans nom** |
| Notre code | La requête est structurellement identique à l'échantillon `curl` de la console |
| Authentification | Jeton obtenu à chaque appel, six réponses 201 |

Restent des causes côté compte, que le code ne peut ni voir ni corriger : le
contrat affiche `availableUnits: 30, requestedUnits: 70` et **le compteur ne
décroît jamais**, six envois plus tard. Lecture retenue : les messages
n'entrent jamais dans la chaîne de remise.

### Trois pièges d'API découverts au passage, et ils partagent une signature

1. **L'adresse d'expéditeur n'est pas validée.** Un envoi depuis
   `tel:+237000000000` — format camerounais invalide — reçoit 201.
2. **Le `notifyURL` du corps ne suffit pas.** Orange l'accepte, le renvoie en
   écho, et ne s'en sert jamais tant qu'aucun rappel n'est déclaré dans la
   console. L'écran affichait « None ».
3. **`GET .../requests/{id}/deliveryInfos` répond 405.** Ce point d'entrée
   n'existe pas dans cette version.

La signature commune : **Orange accepte tout à l'appel, puis se tait.** Sans
rappel déclaré, il n'existe donc aucun moyen — ni interrogation, ni
notification — d'observer le sort d'un message. Un canal d'authentification ne
peut pas reposer là-dessus.

## Alternatives examinées

**MTN.** Le portail MADAPI sert bien le Cameroun — OAuth, Payments, MoMo
Withdrawals et Locations listent `Cameroon` parmi quinze pays. Mais **le produit
SMS n'y est ouvert qu'au Nigeria**, et la spécification OpenAPI téléchargée ne
contient aucune notion de pays : la restriction est commerciale, pas technique.
Elle ne se contourne pas en écrivant du code. Et même ouverte, MTN ne dessert
que ses propres abonnés : il faudrait deux intégrations et un routage par
préfixe. Écartée pour la v1 ; réexaminable si le catalogue camerounais s'ouvre.

**WhatsApp** (`SMS_PROVIDER=whatsapp`, déjà implémenté). Reste le repli
immédiat, au prix documenté par l'ADR 0025 : les deux codes arrivant sur la même
puce, la vérification du numéro de reversement n'atteste plus le contrôle de ce
numéro. Non retenu comme canal principal tant qu'un vrai SMS est atteignable.

**Attendre le support Orange.** Non exclusif de cette décision — le ticket part
avec les six identifiants de requête. Mais le parcours vendeuse ne peut pas
rester fermé en attendant un délai qu'on ne maîtrise pas.

## Décision

**Ajouter `mboasms` comme cinquième valeur de `SMS_PROVIDER`**, avec un
adaptateur dédié. Trois raisons, dans cet ordre :

1. **Elle annonce la livraison directe vers MTN, Orange ET Camtel** — c'est
   textuel sur leur page de tarifs. C'est la propriété qui avait fait retenir
   `sms-cm`, et que MTN seul n'aurait pas donnée.
2. **Paiement à l'usage, inscription gratuite, règlement Mobile Money.** Pas de
   forfait prépayé dont l'état reste incompréhensible — la panne du jour.
3. **Un point d'entrée dédié à la 2FA**, `send-otp`, que la documentation
   recommande pour les codes de vérification.

Orange **n'est pas retiré**. `SMS_PROVIDER=orange` reste câblé et testé : si le
support débloque le compte, on y revient en une variable.

## Ce que l'adaptateur fait de la leçon du jour

`sms-provider.ts` énumérait trois décisions à prendre avant de le remplir. Deux
sont tranchées ici — le fournisseur, et l'identifiant d'expéditeur, qui se
déclare auprès de la passerelle et non dans le code. La troisième, **le
comportement en cas d'échec partiel**, reçoit une réponse concrète :

> **Un HTTP 200 ne vaut pas un envoi.**

L'adaptateur exige `success: true` **et** au moins un destinataire retenu. Un
corps illisible — page HTML d'un intermédiaire, par exemple — est un échec, pas
un succès par défaut. C'est la traduction directe des six 201 d'Orange qui ne
sont jamais arrivés, et c'est couvert par trois tests.

Deux règles reprises des adaptateurs existants : **le corps d'erreur n'est
jamais recopié** — une passerelle qui refuse renvoie couramment la requête, donc
le texte, donc l'OTP — et **un seul destinataire par appel**, bien que le champ
soit un tableau, parce qu'un code est nominatif et qu'un échec partiel devrait
sinon dire *qui* n'a pas reçu.

## Ce qu'on ne saura pas

**La documentation MboaSMS n'expose ni rappel de livraison, ni rapport de
remise.** « Suivi en temps réel » est annoncé côté plateforme, rien n'est offert
au code. On garde donc l'angle mort d'aujourd'hui : accepté ≠ reçu.

C'est dit dans `.env.example` et dans l'en-tête de l'adaptateur, conformément à
AGENTS.md §7.7. À demander à la passerelle avant tout engagement de volume — et
si un rappel existe, `routes/accuse-livraison.ts` sait déjà en recevoir un et
ventiler par opérateur.

**La couverture réelle des trois réseaux reste une annonce commerciale**, pas
une mesure. Elle se vérifie par un envoi vers un numéro MTN, comme pour Orange.
Tant que ce test n'a pas été fait, ce choix vaut une hypothèse motivée, pas un
fait établi.

## Conséquences

- Le parcours vendeuse redevient franchissable sans le compromis de l'ADR 0025.
- Une dépendance de plus, locale, dont on ne connaît pas encore la fiabilité.
- Orange, WhatsApp et `console` restent disponibles : le retour arrière est une
  variable d'environnement, pas un déploiement.
- `docs/terrain/orange-sms-contrat.mjs` garde sa valeur : il documente une API
  qu'on n'abandonne pas, et les trois pièges mesurés y sont consignés.
