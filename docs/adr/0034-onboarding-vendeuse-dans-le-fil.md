# 0034 — Un seul WABA, et l'onboarding vendeuse dans le fil

Date : 02/08/2026 · Statut : accepté · Complète : 0027, 0031, 0032, 0033

## Contexte

Le bot sert toutes les boutiques depuis **un seul numéro WhatsApp**. La
question posée : comment une vendeuse s'inscrit-elle dans ces conditions ?

Elle est légitime, mais elle porte une prémisse fausse — que le WABA unique
serait une contrainte à contourner. C'est l'inverse : c'est la seule
architecture compatible avec la promesse du produit. Ce qui était réellement
cassé, c'est l'onboarding *dans* ce cadre, et c'était visible dans le code.

## Décision 1 — un seul WABA, et ce n'est pas un compromis

Un WABA par vendeuse est **impossible**, pour trois raisons dans l'ordre où
elles tuent l'option :

1. **Le RCCM.** Un WABA exige une entité vérifiable par Meta. AGENTS.md §2
   promet l'inverse aux vendeuses : « aucun compte à ouvrir, **aucun registre
   de commerce à fournir** ». La quasi-totalité d'entre elles n'a pas de
   RCCM — elles ne *peuvent pas* obtenir de WABA.
2. **Le numéro personnel serait confisqué.** Un numéro branché sur l'API
   quitte l'application WhatsApp ordinaire : plus de conversations, plus de
   Statut — qui est le principal canal marketing des vendeuses camerounaises.
   Ça détruit l'invariant « l'acheteuse et la vendeuse continuent de se parler
   sur WhatsApp ».
3. **L'économie.** Tout abonnement mensuel par numéro chez un BSP mange
   l'essentiel des 2 500 F d'ARPU. Un numéro dédié par vendeuse est
   structurellement déficitaire.

Techniquement, la voie existe (programme partenaire 360dialog, embedded
signup multi-numéros) : elle s'adresse à des clients qui sont eux-mêmes des
entreprises constituées. Pas à une vendeuse de pagne à Douala.

**Et le numéro partagé est un ATOUT.** Un reçu émis par la vendeuse elle-même
ne vaut rien ; un reçu émis par un tiers neutre vaut quelque chose. Le numéro
Catalog est celui du notaire, pas une marque blanche de chaque boutique.

Le corollaire à surveiller : une seule note de qualité, un seul point de
défaillance. Notre bot **n'initie jamais** de conversation, ce qui protège
naturellement la note ; mais le risque existe et doit rester su.

## Décision 2 — aiguiller sur le GESTE, pas sur l'identité

`domain/bot/aiguillage.ts`, pur et minuscule. Il corrige deux défauts réels :

- **Une vendeuse ne pouvait pas acheter.** `if (utilisateur?.seller)`
  envoyait *tous* ses messages au fil vendeuse. Or les vendeuses s'achètent
  entre elles — le demi-gros est la norme. Une vendeuse qui ouvrait le lien
  d'une consœur recevait « Collez ici le SMS de votre opérateur ».
- **Une prospect tombait dans le fil acheteuse** et s'entendait répondre
  d'ouvrir le lien d'une boutique qu'elle n'a pas. L'entonnoir fuyait au
  premier message.

L'ordre des règles est le contrat : inscription en cours → gestes vendeuse
explicites → achat → défaut selon ce qu'on est.

## Décision 3 — l'inscription vit dans le fil, photos comprises

Le message entrant **atteste le numéro** : Meta donne le `wa_id`, personne ne
peut l'usurper. C'est exactement la force de preuve du défi de l'ADR 0027,
dans l'autre sens — donc aucun code à ressaisir, aucun navigateur à ouvrir.

Le parcours : « vendre » → nom de la boutique → ville → **la boutique
existe**, avec son lien et son lien de parrainage → premier article (nom,
prix, photo). L'article s'ajoute ensuite à vie par « ajouter ».

**La photo passe par le même pipeline que l'espace vendeuse** : signature
binaire validée, rotation EXIF appliquée puis retirée, métadonnées
supprimées — donc les coordonnées GPS du domicile —, re-encodage sous 100 Ko
en AVIF, WebP et JPEG (ADR 0016, 0032). Rien n'est allégé parce que l'origine
est WhatsApp : le client n'est jamais cru, et WhatsApp est un client comme un
autre.

Le lecteur de médias distingue les deux formes de réponse **en regardant la
réponse**, pas la configuration : JSON → URL signée puis téléchargement
(Cloud API) ; octets directs (v1). La seconde forme n'est **pas vérifiée**,
le relais entrant du sandbox étant en panne — elle est marquée comme telle
(AGENTS.md §7.7).

### La frontière que le fil ne franchit pas

**Le numéro de reversement ne se pose jamais dans le fil.** Il garde son OTP
propre : c'est le champ qu'un attaquant chercherait à détourner (AGENTS.md
§2), et l'ADR 0025 a déjà acté le garde-fou du canal WhatsApp. Une boutique
née dans le fil vend donc en `sans_prepaiement` — le code sait déjà le faire
(ADR 0031) — jusqu'à ce que sa vendeuse pose son reversement dans l'espace
vendeuse.

C'est la bonne frontière : le fil ouvre une boutique, il ne déplace pas
d'argent.

## Décision 4 — ouverture libre, parrainage attribué

N'importe qui peut ouvrir une boutique en écrivant « vendre ». Le lien de
parrainage pré-remplit « vendre avec &lt;slug&gt; », seul porteur de
l'attribution — on ne devine jamais une marraine autrement. `seller.parrainId`
et `seller.canalOuverture` enregistrent l'origine.

**Aucune récompense n'est calculée**, ni ici ni ailleurs. L'attribution est
une mesure ; la récompense est une décision économique du porteur du produit,
et l'inventer serait deviner un modèle (AGENTS.md §7.7). Un slug de marraine
inconnu n'empêche pas d'ouvrir : il perd seulement l'attribution.

## Conséquences

- `BotConversation.etat` porte désormais soit un état acheteuse, soit un état
  vendeuse ; la relecture essaie l'un puis l'autre et retombe à l'accueil.
- `Seller` gagne `parrainId` et `canalOuverture` (expand).
- `EntreeBot` lit les images ; le fil acheteuse les ignore poliment.
- `slugLibre` et `slugifier` sont exportés de `routes/seller.ts` : une seule
  définition du slug, partagée par le web et le fil.
- Une boutique née dans le fil n'a **ni reversement ni description** au
  départ : elle vend, sans acompte, et s'enrichit ensuite.
- L'inscription est en **français seul**, comme tout le fil vendeuse
  (décision de l'ADR 0033) : l'espace vendeuse entier l'est.
