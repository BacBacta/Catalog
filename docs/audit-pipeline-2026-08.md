# Audit du pipeline Catalog — août 2026

Date : 13/08/2026 · Remplace `docs/analyses/2026-08-07-audit-integral-du-bot.md`
Outil : `apps/api/src/__tests__/harnais/` (ADR 0089)

---

## Ce qu'il faut lire d'abord

Cet audit est **partiel, et il le dit**. La consigne qui gouverne tout ce
document est celle du §13 du protocole : « Je n'ai pas mesuré » est un résultat
acceptable et utile ; « c'est bon » sans preuve ne l'est pas, parce que ça ferme
la question.

**Ce qui est établi par exécution :**

- un harnais pilote le service réel (`traiterLivraisonBot`) contre une vraie
  base, et il tourne dans `pnpm test` ;
- **528 cases** — 24 étapes des deux parcours × 22 familles de geste — ont été
  jouées, et ce qu'elles rendent est enregistré ;
- dix scénarios de parcours produisent des transcriptions lisibles en diff, dont
  neuf tests de non-retour sur les deux constats corrigés.

**Ce qui n'est PAS établi, et ne doit être lu nulle part comme sain :**

| Couche | État |
|---|---|
| Couche | Invariants (dont tenus par **rien**) | Échecs (dont **ni dits ni journalisés**) | Exercée ? |
|---|---|---|---|
| 01 acquisition | 36 (**11**) | 34 (**18**) | non |
| 02 transport entrant | 33 (**8**) | 26 (**17**) | non |
| 03 aiguillage | 26 (3) | 27 (**17**) | indirectement, par le balayage |
| 04 machines de domaine | 27 (2) | 23 (6) | **oui — le cœur de ce lot** |
| 05 données et migrations | 40 (9) | 20 (7) | non |
| 06 argent | 42 (9) | 36 (9) | partiellement (une commande, ses entiers, son invariant) |
| 07 preuve | 40 (2) | 23 (10) | non |
| 08 rampe de paiement | 22 (2) | 20 (**11**) | non |
| 09 médias | 28 (6) | 41 (**24**) | non |
| 10 sortie | 41 (7) | 40 (**28**) | jusqu'à l'envoyeur en mémoire, pas au-delà |
| 11 web public | 43 (4) | 35 (4) | non |
| 12 app vendeuse | 27 (5) | 28 (12) | non |
| 13 jobs | 24 (**12 sur 24**) | 20 (10) | non |
| 14 observabilité | 23 (4) | 22 (14) | non |
| 15 exploitation | 34 (7) | 25 (6) | non |
| **Total** | **486 (91)** | **420 (193)** | |

Deux colonnes suffisent à dire où regarder ensuite. **La couche 13 a la moitié
de ses invariants tenus par rien** — c'est elle qui porte le constat C-003
ci-dessous. Les couches 09 et 10 concentrent les échecs muets : 52 à elles deux.

La cartographie des quinze couches est **terminée** : 486 invariants relevés,
420 chemins d'échec. Elle vient de la LECTURE, et le §0 du protocole interdit de
la traiter autrement — ses relevés sont des pistes, pas des constats. Seule la
couche 04 a été exercée.

---

## §7 — la couverture, mesurée

Le tableau ci-dessous est **produit par exécution**
(`apps/api/src/__tests__/harnais/instantanes/balayage-couverture.md`). Il ne
s'écrit pas à la main.

| Étape | Parcours | Cases possibles | Cases exercées | % |
| --- | --- | --- | --- | --- |
| premier contact (prospect) | vendeuse | 22 | 22 | 100 % |
| nom de la boutique | vendeuse | 22 | 22 | 100 % |
| ville de la vendeuse | vendeuse | 22 | 22 | 100 % |
| fil vendeuse au repos | vendeuse | 22 | 22 | 100 % |
| relecture avant ouverture | vendeuse | 22 | 22 | 100 % |
| nom de l'article | vendeuse | 22 | 22 | 100 % |
| prix de l'article | vendeuse | 22 | 22 | 100 % |
| photo de l'article | vendeuse | 22 | 22 | 100 % |
| confirmation de la légende | vendeuse | 22 | 22 | 100 % |
| comptoir — quel article | vendeuse | 22 | 22 | 100 % |
| comptoir — prix convenu | vendeuse | 22 | 22 | 100 % |
| comptoir — la cliente | vendeuse | 22 | 22 | 100 % |
| comptoir — point de remise | vendeuse | 22 | 22 | 100 % |
| comptoir — récapitulatif | vendeuse | 22 | 22 | 100 % |
| arrivée (aucune boutique ouverte) | acheteuse | 22 | 22 | 100 % |
| catalogue de la boutique | acheteuse | 22 | 22 | 100 % |
| quantité | acheteuse | 22 | 22 | 100 % |
| panier — autre chose ? | acheteuse | 22 | 22 | 100 % |
| livraison ou retrait | acheteuse | 22 | 22 | 100 % |
| ville de livraison | acheteuse | 22 | 22 | 100 % |
| ville dont la forme détonne | acheteuse | 22 | 22 | 100 % |
| quartier, repère, téléphone | acheteuse | 22 | 22 | 100 % |
| récapitulatif avant commande | acheteuse | 22 | 22 | 100 % |
| mot de l'avis | acheteuse | 22 | 22 | 100 % |
| **Total** | — | **528** | **528** | **100 %** |

**Ce que ce 100 % veut dire, et surtout ce qu'il ne veut pas dire.** Il dit que
chacune des 528 cases a été **jouée** et que sa réponse est enregistrée. Il ne
dit pas que la réponse est bonne. Une case exercée qui rend une réponse absurde
reste une case exercée — et l'audit v1 est tombé exactement là.

Le dénominateur est posé d'avance dans `couverture.ts` : on ne peut pas faire
monter le chiffre en retirant des cases. Ajouter une étape au produit sans
l'ajouter au catalogue fait **échouer** le balayage.

---

## Le résultat le plus solide : le produit n'est pas muet

C'est la mesure qui contredit le plus nettement l'audit v1, lequel avait fait du
« silence » son motif unique.

Sur 528 cases jouées, **les seules cases où la personne n'a rien reçu sont les
24 relivraisons** — et c'est le comportement voulu : une livraison déjà traitée
est ignorée (ADR 0040). Toutes les autres cases produisent au moins un message,
y compris le vocal, le sticker, le document, la position hors contexte, le
formulaire tronqué et le bouton d'un message ancien.

Le fichier `balayage-muets.md` est produit à chaque exécution. Le jour où une
case devient muette, la CI rougit.

---

## Constats

Format du §5. **Aucun constat n'est publié ici sans être reproductible par une
commande.**

### C-001 — la ville de livraison accepte n'importe quel texte

| | |
|---|---|
| **Couche** | 04 machines de domaine |
| **Persona** | acheteuse |
| **Étape** | ville de livraison |
| **Famille** | faux |
| **Verdict** | `faux` — le système enregistre comme ville ce qui n'en est pas une |

**Reproduction** — jouée par le harnais, lue en base :

```
boutique <slug> → cmd:<article> → qte:1 → commander → mode:livraison
→ texte « est-ce que vous vendez des chaussures pour bébé ? »
→ texte « Bonapriso, en face de la pharmacie Bleue, 690112233 » → confirmer
```

**Observé**, colonne `order.delivery` :

```json
{"city":"est-ce que vous vendez des chaussures pour bébé ?","mode":"livraison",
 "phone":"+237690112233","landmark":"en face de la pharmacie Bleue",
 "quartier":"Bonapriso"}
```

La commande **est créée**. La vendeuse lira cette ligne comme destination.

**Attendu** — au minimum, que quelque chose signale que la ville n'a pas été
comprise. Une liste blanche de villes est exclue d'avance : il n'existe pas
d'adresse au Cameroun (ADR 0005) et les localités sont innombrables — une liste
ferait plus de dégâts que le défaut.

**Ce que la vérification adverse a ajouté** — la valeur ne dort pas en base.
Elle **sort** : dans le gabarit Meta `catalog_nouvelle_commande_v2` envoyé à la
vendeuse (« Livraison : est-ce que vous vendez des chaussures pour bébé ?,
Bonapriso, … ») et dans le message de commande de l'acheteuse. Et la question
posée n'a jamais reçu de réponse.

**Sévérité** : impact 3 (la vendeuse doit rattraper hors système) × fréquence 2
× détectabilité 4 (rien ne le signale, ni à l'acheteuse ni dans une trace)
= **24**.

**Test qui échouerait aujourd'hui** : jouer le scénario ci-dessus et exiger que
`order.delivery.city` ne soit pas la question, ou qu'un message ait signalé
l'incompréhension.

**Vérification adverse : `CONFIRMÉ` — 1 réfutation sur 3.**

- *reproduction* — confirme, certitude forte. Rejoué contre la base ; identique
  avec le Flow de livraison branché (le formulaire s'ajoute à la question, il ne
  ferme jamais la saisie libre). `12345`, `?? ...`, une URL passent aussi.
- *lecture de code* — confirme, certitude forte. Le seul prédicat est
  `villeAcceptable` (`packages/contracts/src/villes.ts:43`), qui ne teste **que**
  la longueur (2–80). `deliverySchema` appelle le même ; `delivery` est un
  `jsonb` sans `CHECK`. Rejoué aussi sur la machine pure, sans harnais.
- *intention produit* — **réfute**, certitude forte, et sa réfutation borne le
  remède. L'ADR 0050 pose deux décisions qui répondent au constat : il n'y a pas
  de liste de villes **et c'est délibéré** (une liste « déplace le mur à la
  soixantième ville » et exclurait en silence une acheteuse de Foumbot) ; et
  « le récap est le seul garde-fou du produit ; une valeur absurde y est vue
  avant l'appui sur *Confirmer* ».

**Ce que j'en retiens.** Le constat survit à la majorité, et pour une raison que
la réfutation ne couvre pas : **un écho n'est pas un signal**. Le récapitulatif
affiche bien la valeur, mais l'acheteuse n'a pas mal orthographié une ville —
elle a posé une question, et se relire ne lui apprend pas que le bot l'a rangée
comme destination.

**Mais le remède évident est interdit**, et il faut le dire avant d'en proposer
un : fermer le vocabulaire rouvrirait l'ADR 0050, et détecter une question dans
le tunnel rouvrirait l'ADR 0051 (`questionFrequente` existe dans le dépôt et est
**explicitement fermée** hors `accueil`/`catalogue` — dans le tunnel, un texte
libre est du contenu par décision). Tout correctif porte donc sur la **forme**,
jamais sur le mot, et **demande** au lieu de refuser. C'est un arbitrage produit,
pas une correction : voir la fin de ce document.

---

### C-002 — le nom de boutique accepte n'importe quel texte, et il devient un slug public

| | |
|---|---|
| **Couche** | 04 machines de domaine |
| **Persona** | vendeuse |
| **Étape** | nom de la boutique |
| **Famille** | faux |
| **Verdict** | `faux` |

**Reproduction** :

```
bouton « vendre » → texte « est-ce que vous vendez des chaussures pour bébé ? »
→ texte « Douala »
```

**Observé**, table `seller` :

```
businessName = "est-ce que vous vendez des chaussures pour bébé ?"
slug         = "est-ce-que-vous-vendez-des-chaussures-pour-bebe-2"
```

Le bot a répondu « *est-ce que vous vendez des chaussures pour bébé ?* — c'est
noté. » puis a ouvert la boutique. **Le slug est l'URL publique partageable** de
la vendeuse, et le fil ne propose aucun moyen de la corriger.

**Ce que la vérification adverse a ajouté, et qui aggrave le constat** :
« pas rattrapable depuis le fil » était trop doux. **Aucun chemin de renommage
n'existe nulle part** — ni dans le bot (le menu vendeuse n'offre que article /
carte / ma boutique / soldes / congés), ni dans l'app vendeuse
(`apps/seller/src/lib/api.ts` ne connaît que `creerProfil`, jamais une mise à
jour). Le nom et le slug sont posés par **un seul message libre**, sans
récapitulatif, et figés.

**Sévérité** : impact 4 (aucun recours, et l'objet est public) × fréquence 2 ×
détectabilité 4 = **32**.

**Test qui échouerait aujourd'hui** : après ce scénario, exiger que la boutique
n'ait pas été créée sans confirmation — ou qu'un chemin de renommage existe.

**Vérification adverse : `CONFIRMÉ` — 0 réfutation sur 3, unanime.**

- *reproduction* — rejoué trois fois, même ligne `seller`. Le chemin
  question-par-question **est** celui de production (`WABOT_FLUX_INSCRIPTION_ID`
  est vide dans `.env.example`), et le chemin Flow applique la même borne.
- *lecture de code* — le seul contrôle est une borne de **longueur** (2–80).
  Aucun schéma Zod ne couvre `businessName` : `packages/contracts/src` ne le
  connaît pas, alors qu'AGENTS.md §6 en fait la source de vérité des types. En
  base, `business_name` est un `TEXT NOT NULL` **sans `CHECK`**.
- *intention produit* — **aucun des 88 ADR ne traite du nom de boutique ni de
  son slug.** L'ADR 0052, le plus proche, va dans le sens du constat : sa
  doctrine est « quand c'est ambigu, on pose la question ».

Le slug lui-même n'est pas en cause : `slugifier` borne déjà à 48 caractères
(`apps/api/src/routes/seller.ts:119`). Ce qui est en cause est qu'un nom soit
posé sans confirmation et sans recours.

---

### C-003 — l'expiration des commandes et les rappels de solde n'existent qu'en théorie

| | |
|---|---|
| **Couche** | 13 jobs |
| **Persona** | les deux |
| **Famille** | silence |
| **Verdict** | `muet` |
| **Statut** | `PLAUSIBLE` — établi par lecture exhaustive, **pas encore par exécution** |

C'est le constat que l'audit v1 ne pouvait pas trouver : il ne se voit dans
aucun parcours, et il compte autant (§2 du protocole).

**Ce qui existe.** `apps/api/src/domain/order/expiration.ts` est complet et
testé : `FENETRE_EXPIRATION_MS` vaut 48 h, `RAPPELS_HEURES` vaut `[2, 24]`,
`doitExpirer` et `etatExpiration` décident proprement. `Order.expiresAt` est
**écrite** à chaque création de commande (`bot.ts:2271`).

**Ce qui manque.** Rien ne l'appelle :

```
$ grep -rn "doitExpirer|etatExpiration|RAPPELS_HEURES" apps packages \
    --include=*.ts | grep -v __tests__ | grep -v domain/order/expiration.ts
(aucun résultat)
```

`Order.expiresAt` est écrite et **jamais relue** — les seuls lecteurs
d'`expiresAt` dans le dépôt sont l'OTP de reversement et la connexion WhatsApp,
sur d'autres tables. Et pg-boss ne monte que **deux** files, toutes deux de
relance : `bot-relance-acompte` et `bot-relance-reversement`.

**Conséquence.** Une commande non payée reste ouverte indéfiniment. Les rappels
de solde à 2 h et 24 h ne partent jamais. `CLAUDE.md` et `AGENTS.md` §3
affirment pourtant que pg-boss sert aux « relances d'expiration de commande » et
aux « rappels de solde » : **la documentation décrit un comportement que le code
n'a pas**, et c'est ce décalage qui rend le défaut durable.

**Sévérité** : impact 3 × fréquence 5 (chaque commande non payée) ×
détectabilité 5 (rien ne le signale, aucune trace, aucun écran) = **75**.

**Pourquoi il n'est pas corrigé ici.** Le brancher demande de décider ce que
« expirée » veut dire pour une commande dont l'acompte est partiellement payé,
et si la vendeuse doit en être prévenue — deux décisions produit. Et il doit
passer par la vérification adverse comme les autres. C'est le lot suivant.

### Ce que la cartographie a relevé et que le harnais n'a PAS vérifié

Quatre couches sur quinze ont été cartographiées. Leurs relevés sont des
**pistes**, pas des constats : ils viennent de la lecture, et le §0 du protocole
interdit de les traiter autrement tant qu'une exécution ne les a pas éprouvés.

Les plus structurants, à instruire dans un lot suivant :

- **transport entrant** — aucune fraîcheur n'est exigée d'une livraison signée
  (ni horodatage, ni nonce, ni fenêtre) : un corps signé capturé reste rejouable
  (`routes/whatsapp-entrant.ts:78`) ;
- **transport entrant** — sans `wamid`, aucune idempotence n'est appliquée
  (`bot.ts:289`), et l'échec de la réclamation fait traiter quand même
  (`.catch(() => true)`, `bot.ts:290`) ;
- **aiguillage** — écrire l'état d'un fil **détruit** l'état de l'autre, et rien
  ne le retient ni ne le dit (`bot.ts:961`) ;
- **aiguillage** — deux livraisons concurrentes du même numéro ne sont pas
  sérialisées : l'état est lu puis réécrit sans verrou ;
- **acquisition** — un slug de boutique n'est pas empêché d'entrer en collision
  avec une route statique de la boutique publique (`/payer`, `/v`, `/suivi`) ;
- **acquisition** — plusieurs chemins de la carte-vitrine échouent en silence
  (QR non rendu, photo illisible, objet illisible) : la carte part dégradée sans
  qu'aucune trace n'en garde mémoire ;
- **jobs** — aucune file morte (*dead letter*) sur les deux files existantes, et
  aucun job n'est instrumenté : un échec répété en production ne se voit nulle
  part ;
- **données** — le vocabulaire de `order_event.actor` et de
  `ledger_entry.direction` n'est tenu par aucun `CHECK` ; `ledger_entry.order_id`
  et `proof_id` n'ont pas de clé étrangère ;
- **argent** — le montant du lien `/payer` n'est rapproché d'aucune commande
  côté serveur, et aucun montant n'entre dans `order_event`.

Chacune de ces pistes demande son propre scénario de harnais. Aucune ne doit
entrer dans un rapport comme un défaut avant.

---

## Plan de lots

Un lot par session (AGENTS.md §7.1).

| Lot | Contenu | Prérequis |
|---|---|---|
| **A** *(fait)* | le harnais, le balayage, les instantanés, l'ADR 0089 | — |
| **B** *(fait)* | cartographie des quinze couches — 486 invariants, 420 chemins d'échec | — |
| **C** *(fait)* | C-001 et C-002 corrigés — ADR 0090, 0091, 0092 | arbitré par le porteur |
| **D** | étendre le harnais à la preuve (couche 07) — sept contrôles, SMS collé, contre-signature | lot A |
| **E** | **C-003** — brancher l'expiration et les rappels, ou dire qu'ils n'existent pas | arbitrage produit |
| **F** | instruire les pistes du transport entrant : rejeu d'un corps signé, livraisons concurrentes | lot B |

L'ordre a changé après la cartographie : **E remonte juste après D**. C-003 est à sévérité 75, contre 32 et 24 pour les deux premiers.

L'ordre n'était pas négociable sur un point : **C avant D**. Deux constats
confirmés à sévérité 24 et 32 pèsent plus qu'une couche supplémentaire
cartographiée.

---

## L'arbitrage — posé, puis rendu

Les deux constats sont confirmés, et **leurs deux remèdes évidents rouvraient
chacun une décision documentée**. AGENTS.md §7.7 nomme la dérive silencieuse
comme le vrai risque de ce dépôt, bien avant la qualité du code : la décision a
donc été posée au porteur du produit, avec la mesure en main, au lieu d'être
prise ici.

**Il a tranché : confirmation ET renommage pour C-002 ; confirmation sur la
forme pour C-001.** Les deux sont implémentés (ADR 0090, 0091, 0092), avec neuf
tests de non-retour. Ce qui suit est le raisonnement tel qu'il a été présenté.

**Pour C-002 — confirmer le nom de boutique avant de l'ouvrir.** Le geste
naturel est un récapitulatif, exactement comme la photo légendée en a déjà un
(« J'ai lu : *X* — *Y*. C'est bon ? »). Mais cela **ajoute une bulle à
l'ouverture**, et l'ADR 0088 — daté du même jour que cet audit — vient de la
ramener à une seule, sur la parole du porteur du produit : « une multiplication
de messages et de liens rendant touffu le chat, c'est confondant ». Choisir à sa
place vingt-quatre heures après serait précisément la faute que ce protocole
existe pour empêcher.

L'alternative — ouvrir un chemin de **renommage** plutôt qu'une confirmation —
n'ajoute aucune bulle et ne contredit aucun ADR. Mais elle crée une route et un
écran : c'est une décision produit, pas une correction.

**Pour C-001 — signaler une ville qui n'en a pas l'air.** Le remède ne peut
porter que sur la forme (une question, une URL, des chiffres seuls), jamais sur
le vocabulaire : l'ADR 0050 a explicitement refusé toute liste de villes, et
l'ADR 0051 a explicitement fermé la détection de question à l'intérieur du
tunnel. Un correctif ici rouvre l'un ou l'autre.

### Ce que l'arbitrage a produit

- **ADR 0090** — un état `inscription_confirme` relit le nom et la ville avant
  d'ouvrir. Une bulle de plus à l'ouverture, assumée, vingt-quatre heures après
  que l'ADR 0088 l'a ramenée à une.
- **ADR 0091** — `villeDouteuse` regarde **quatre formes** (point
  d'interrogation, aucune lettre, adresse web, plus de cinq mots) et **jamais un
  mot**. Aucune liste de villes : l'ADR 0050 tient, et un test le garde en
  vérifiant que Foumbot, Kribi et Ngaoundéré passent sans question. « Oui »
  garde la saisie telle quelle — on demande, on ne refuse jamais.
- **ADR 0092** — une route de renommage et une carte dans les réglages. **Le
  slug ne bouge pas** : l'adresse a peut-être déjà été partagée, et un lien
  cassé « se voit chez l'acheteuse, une fois, et elle ne revient pas »
  (ADR 0073). L'écran le dit en toutes lettres.

Le catalogue de couverture du harnais passe de 484 à **528 cases**, les deux
nouveaux états compris : le balayage échouerait s'ils n'y étaient pas.

---

## Ce que cet audit n'a pas fait, et qu'il faut savoir

- **Les onze couches marquées `non mesuré` le sont réellement.** Aucune n'a été
  déclarée saine.
- **La base locale est PostgreSQL 16**, la pile épingle 18 (AGENTS.md §3). La CI
  tourne bien sur `postgres:18-alpine` ; un écart entre majeures ne serait pas vu
  en local.
- **Rien n'a été envoyé à Meta.** L'envoyeur est en mémoire : un refus HTTP, un
  gabarit hors fenêtre ou un média introuvable ne sont pas exercés.
- **Les trois points volontairement non faits n'ont pas été rouverts** :
  `product.variants` reste une colonne morte, `PIDGIN_RELU` reste `false`, et
  rien de ce qui exige un gabarit utilitaire n'a été construit. Le harnais
  *envoie* du pidgin — l'entrée n'est pas fermée, seule la sortie l'est — et
  mesure que la réponse reste en français, ce qui est le comportement décidé.
