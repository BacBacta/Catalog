# ADR 0027 — Connexion par WhatsApp entrant : la vendeuse envoie, Catalog reçoit

- **Statut** : accepté
- **Date** : 01/08/2026
- **Lot** : aucun — décision prise pendant le déblocage du canal de connexion
- **Concerne** : `apps/api/src/domain/connexion-whatsapp.ts`,
  `apps/api/src/auth-connexion-whatsapp.ts`, `apps/api/src/routes/whatsapp-entrant.ts`,
  `apps/api/src/auth.ts`, `apps/api/src/middleware/debit.ts`,
  `apps/seller/src/routes/Connexion.tsx`, `apps/seller/src/routes/ConnexionWhatsApp.tsx`,
  `docs/maquettes/connexion-whatsapp.html`, `.env.example`
- **Complète** les ADR 0025 (canal du code de connexion) et 0026 (passerelle
  MboaSMS). Ne révise rien : l'OTP SMS et le gabarit WhatsApp restent câblés.

## Contexte

Le canal de connexion des vendeuses repose sur un OTP livré par SMS, et la
journée du 01/08/2026 a établi que ce sens de circulation est le problème :
l'API Orange accepte tout en 201 et ne remet rien tant que le **nom
d'expéditeur** n'est pas inscrit sur liste blanche — démarche commerciale, à
répéter **chez chaque opérateur** pour joindre les numéros non-Orange (ADR
0026). MboaSMS mutualise cette démarche mais reste un fournisseur à éprouver,
et le gabarit WhatsApp sortant (ADR 0025) exige une approbation Meta et porte
un compromis connu : les deux OTP arrivent sur la même puce.

Toutes ces voies partagent une propriété : **c'est Catalog qui envoie**, et
tout ce qui rend l'envoi fragile — listes blanches, gabarits, forfaits — est
hors de notre contrôle.

## Décision

Ajouter un canal où le sens est inversé : **la vendeuse envoie, Catalog
reçoit**.

1. L'app demande un **défi** à l'API et ouvre `wa.me/<numéro Catalog>` avec un
   message pré-rempli portant un code court (`7F3K-2M`).
2. La vendeuse appuie sur envoyer. Le webhook Meta livre le message avec son
   `wa_id` — **son numéro, attesté par Meta**, pas déclaré par elle.
3. L'app, qui sonde le statut, échange alors son jeton contre une session.

Zéro code à recopier, zéro SMS sortant, zéro gabarit à faire approuver — les
approbations Meta ne concernent que les messages à l'initiative de
l'entreprise. La réception est libre, et gratuite aux conditions actuelles.

## Les trois clés, et pourquoi trois

| Clé | Voyage où | Pouvoir |
|---|---|---|
| `code` | dans le message WhatsApp | identifier le défi ; public dès l'envoi |
| `jeton` | corps de requête, jamais une URL | **seul** à valoir une session |
| `suivi` | URL du sondage GET | lire un statut ; n'autorise rien |

C'est la grammaire de l'ADR 0021 — deux clés, deux pouvoirs — appliquée à la
connexion. La séparation `jeton`/`suivi` n'est pas décorative : le sondage
passe en GET toutes les 3 s, donc sous la famille `lecture` du limiteur de
débit (un POST épuiserait la famille `ecriture` en une minute), et un jeton en
URL serait un jeton dans les journaux d'accès — l'interdit posé pour
`buyerToken` par l'ADR 0023.

## Le magasin : `authVerification`, zéro migration

Un défi vit dans la table de vérification de Better Auth, sous trois
identifiants (`conn-wa-code:`, `conn-wa-defi:`, `conn-wa-suivi:`), avec la
même échéance — vérifier un défi ne le prolonge pas. L'usage unique est tenu
par `consumeVerificationValue`, qui est **atomique** (trouve-et-supprime) :

- un message relivré par Meta tombe sur un code déjà consommé ;
- deux onglets qui échangent le même jeton ne font qu'une session — le verdict
  se prend sur l'enregistrement *consommé*, pas sur la lecture qui précède.

La création d'utilisateur est le **miroir exact** du `signUpOnVerification` du
plugin `phoneNumber` — même adresse technique, même nom — pour qu'une vendeuse
arrivée par OTP se connecte par WhatsApp sur le même compte, et inversement.

## Sécurité

**Le webhook exige deux serrures, et la seconde n'est pas optionnelle.** Le
secret d'URL (comparé à longueur constante, comme l'accusé Orange) coupe le
bruit ; la signature `X-Hub-Signature-256` — HMAC du corps **brut** avec l'App
Secret Meta — prouve que la livraison vient de Meta. Sans elle, quiconque
connaît l'URL fabrique un faux message entrant, c'est-à-dire une connexion au
compte de n'importe quelle vendeuse dont il provoque un défi. La route
n'existe que si les deux secrets sont configurés, et `/api/whatsapp/` a été
ajouté aux familles du limiteur de débit — le test l'a exigé : le chemin
n'était couvert par aucune.

**Le relais social** — « envoie ce message pour moi » — est l'attaque
résiduelle, équivalente au phishing d'OTP. Trois défenses : le texte du
message se défend seul (« si on vous a demandé d'envoyer ce message pour
quelqu'un d'autre, ne l'envoyez pas ») ; la session n'est remise qu'au
navigateur porteur du jeton, jamais à WhatsApp ; et se connecter ne donne pas
accès au numéro de reversement, qui garde sa vérification propre.

**Le numéro de connexion devient le numéro WhatsApp.** C'est l'hypothèse de
l'ADR 0025 assumée au grand jour, et pour ce produit — des vendeuses qui
vendent *déjà* sur WhatsApp — c'est un alignement, pas une contrainte.

## Ce que cela ne remplace pas

- **L'OTP SMS reste à l'écran**, sous le bouton WhatsApp : une vendeuse sans
  WhatsApp existe peu, mais elle existe. Le bouton n'apparaît que si l'API
  annonce le canal configuré.
- **Le numéro de reversement garde son OTP par SMS.** Ce canal-ci ne porte que
  la connexion ; l'aiguillage par `kind` envisagé par l'ADR 0025 reste ouvert,
  et ce flux le rend plus intéressant encore : connexion par WhatsApp entrant,
  reversement par SMS — les deux preuves ne partagent plus un canal.

## Ce qu'il reste à faire pour l'allumer

Un compte **WhatsApp Business (WABA)** avec un numéro dédié, l'API Cloud, et
trois variables : `WHATSAPP_WABA_NUMERO`, `WHATSAPP_ENTRANT_SECRET`,
`WHATSAPP_APP_SECRET`. Tant qu'elles manquent, le canal est fermé proprement :
bouton absent, défi refusé, webhook inexistant.

Deux points restent dits et non comblés (AGENTS.md §7.7) : la gratuité de la
réception est **aux conditions actuelles de Meta**, qui ont déjà changé par le
passé ; et le parcours n'a pas encore été éprouvé sur un téléphone réel avec
un vrai WABA — la maquette `docs/maquettes/connexion-whatsapp.html` montre le
parcours cible, elle ne le prouve pas.
