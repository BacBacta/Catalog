# 0046 — Le transport WhatsApp devient explicite

Date : 2026-08-05
Statut : accepté
Corrige : une affirmation de `docs/terrain/test-bot-sandbox.md`
Concerne : `apps/api/src/adapters/whatsapp-*.ts`

## Contexte

Le porteur du produit a obtenu de Meta un numéro `+1 555 462 4305` et ne
parvenait pas à l'ajouter à l'application WhatsApp Business.

C'est attendu : `+1 555` est la signature d'un **numéro de test Meta**. Ce
n'est pas une ligne — ni SIM, ni opérateur, rien qui puisse recevoir un code.
Il n'existe qu'à travers l'API. L'application demande une vérification que
personne ne peut satisfaire.

Il a pourtant une valeur que rien d'autre n'a : **il offre de vrais médias**.
Le bac à sable 360dialog n'en a aucun — sa documentation l'écrit —, et c'est
pour cette raison que le troisième critère de sortie du lancement, *un article
créé depuis le fil porte-t-il sa photo*, n'a **jamais** pu être vérifié.

## L'affirmation qui était fausse

`docs/terrain/test-bot-sandbox.md` disait, depuis des semaines :

> Le numéro de test Meta […] Il faut pointer son webhook vers
> `/api/whatsapp/entrant/<secret>` et aligner `WHATSAPP_APP_SECRET`,
> `WABOT_API_KEY` et `WABOT_BASE_URL` sur l'app Meta — **c'est un changement
> d'environnement, pas de code.**

Vérification faite dans les adaptateurs : c'était faux sur **trois** points.

| | 360dialog | Meta directe |
|---|---|---|
| Authentification | `D360-API-KEY: <clé>` | `Authorization: Bearer <jeton>` |
| Envoi | `{base}/messages` | `{base}/{idNuméro}/messages` |
| Média, 2ᵉ temps | hôte de l'URL **réécrit** vers celui de l'API | URL suivie **telle quelle** |

Le troisième est de loin le plus coûteux. La réécriture d'hôte est
**indispensable** chez 360dialog — leur documentation l'exige, et l'omettre a
coûté le diagnostic du 02/08/2026. Appliquée à Meta, elle **casse** le
téléchargement : l'URL de `lookaside.fbsbx.com` accepte le jeton porteur telle
quelle, et l'envoyer vers `graph.facebook.com` produit un chemin qui n'existe
pas.

**Ce défaut ne se voit qu'en téléchargeant une vraie photo.** Il était donc
invérifiable sur le seul canal dont on disposait, et il attendait précisément
le jour où on brancherait Meta pour se manifester — c'est-à-dire le jour où on
compterait dessus.

## Décision

Un module `whatsapp-transport.ts` porte les trois différences, et rien d'autre.
Le domaine reste inchangé : **il ne sait pas qui transporte ses messages**,
c'est ce qui rend ce module possible.

### Le transport se déduit, il ne se déclare qu'en dernier recours

`resoudreTransport(declare, baseUrl)` lit l'hôte de la base :
`*.360dialog.io` → `360dialog`, `*.facebook.com` → `meta`.

**Aucun déploiement existant n'a de variable à ajouter**, et aucun ne tombe au
premier redémarrage. `WABOT_TRANSPORT` ne sert qu'à trancher un hôte inconnu —
un relais, un mandataire.

### Et il REFUSE la contradiction

Si la déclaration et l'hôte se contredisent, **le service ne démarre pas**.

Ce n'est pas du zèle. Une base Meta avec une clé 360dialog rend des HTTP 401
qu'on impute naturellement à la clé, et on passe la soirée à en régénérer une.
Le message d'erreur nomme les deux valeurs et dit que l'une est fausse.

Même logique pour le transport `meta` sans `WHATSAPP_PHONE_NUMBER_ID` : l'échec
est à la **construction**, pas au premier envoi. Un HTTP 404 sur un message
réel, la nuit du lancement, est le pire endroit pour apprendre ça. C'est la
leçon de MboaSMS (ADR 0026), appliquée une fois de plus.

### Le repli on-premise ne se tente que chez 360dialog

La forme `{base}/media/{id}` est une particularité on-premise de 360dialog.
Chez Meta elle est garantie perdante : un appel de plus sur le chemin d'une
photo qui n'arrive déjà pas.

## Ce que le numéro de test permet, et ce qu'il ne permettra jamais

**Permet** — le seul chemin jamais vérifié : entrant, sortant, **et médias**.
De quoi enfin fermer le troisième critère de sortie.

**Ne permettra jamais** :

- s'ajouter à l'application WhatsApp Business (aucune ligne derrière) ;
- écrire à quelqu'un hors des **5 destinataires** inscrits au tableau de bord ;
- devenir le numéro de production — il n'y a pas de « passage », le vrai numéro
  s'ajoute séparément.

**Le piège du jeton** : celui qu'affiche le tableau de bord Meta **expire en
24 h**. Le bot cesserait d'envoyer du jour au lendemain sans que rien d'autre
ne change. Il faut un jeton de *System User*, sans expiration.

## Ce qui reste à faire, et qui n'est pas du code

Pour la production il faut un **vrai numéro +237** qui remplisse deux
conditions, dont la seconde est irréversible :

1. il peut recevoir **un** code, par SMS ou par appel ;
2. **il cessera définitivement de fonctionner dans l'application WhatsApp** une
   fois inscrit à l'API. La SIM devient API-only.

C'est la raison d'être de la ligne « SIM +237 dédiée » dans les préalables —
pas la ligne personnelle du gérant.

## Ce que cet ADR NE fait pas

Il ne branche rien. Les secrets Fly ne sont pas posés : le code est prêt, la
configuration est une opération, et elle demande un jeton Fly que la session
n'a pas. La marche à suivre est dans `docs/terrain/test-bot-sandbox.md`.
