# 0063 — Trois formulaires, un seul passage chez Meta

Date : 2026-08-11
Statut : accepté
Achève : l'ADR 0055, resté à moitié fait faute d'API
Sprint : « le bot devient une application », chantier d
Concerne : `domain/bot/flux.ts`, `conversation.ts`, `bot.ts`, `server.ts`,
`scripts/flux.mjs`, `docs/flux-*.json`

## Ce qui a débloqué

L'ADR 0055 s'était arrêté sur une mesure : l'API de notre clé 360dialog
n'exposait **que** les gabarits et la configuration de réception.
`/v1/configs/flows`, `/v2/flows`, `/v1/flows` rendaient tous 404. Un Flow ne
pouvait être ni créé ni testé depuis le dépôt — le domaine était écrit, la
jonction restait impossible.

La bascule en direct chez Meta (ADR 0046) rouvre ce chemin. Les trois
formulaires se déposent donc maintenant, et **en un seul passage** : c'est
l'objet de cet ADR.

## Les trois formulaires

| Formulaire | Champs | Remplace |
|---|---|---|
| `catalog_livraison` | ville, quartier, repère, téléphone | 3 questions |
| `catalog_inscription` | boutique, ville, langue | 2 questions |
| `catalog_avis` | note (★), mot | 2 questions |

Aucun ne s'appelle « adresse » — il n'en existe pas au Cameroun (ADR 0005), et
un test le vérifiait déjà.

**Ce qui n'y est PAS : le numéro de reversement.** Il exige son propre OTP,
envoyé au **nouveau** numéro — c'est ce qui prouve que la vendeuse tient la
puce où l'argent va arriver. Un formulaire statique ne peut pas le vérifier ;
l'y mettre donnerait l'illusion d'une saisie faite alors que le champ le plus
sensible du produit resterait non attesté. Il garde son chemin.

## Le jeton dit quel formulaire a répondu

Une réponse de Flow arrive **toujours** par le même chemin (`nfm_reply`) :
rien dans le message ne dit lequel a répondu. Avec un seul formulaire, la
question ne se posait pas. Avec trois, elle décide de tout — une livraison
remplie pourrait déposer un avis fantôme.

C'est le `flow_token`, choisi par nous à l'envoi et renvoyé tel quel, qui
porte cette information : `livraison:<slug>`, `inscription:`, `avis:`.

Deux propriétés tenues par des tests :

- **il ne porte jamais de secret** — ni `buyerToken`, qui autorise la
  contre-signature (ADR 0021), ni le numéro, que le fil porte déjà. Ce qui part
  dans un message que WhatsApp nous renverra doit pouvoir être lu par
  n'importe qui ;
- **un genre inconnu ne devient jamais un genre connu** — et une réponse de
  livraison ne peut pas déposer un avis.

⚠️ **L'écho du jeton dans `response_json` est le comportement documenté de
Meta, pas une mesure faite ici.** Le repli est donc choisi pour rendre
l'erreur bénigne : sans jeton, c'est la livraison — le seul formulaire déployé
avant les deux autres. Une réponse en vol au moment du déploiement ne se perd
pas.

## Ce qui ne change pas

**Le chemin question-par-question reste, partout.** Ce n'est pas une
précaution transitoire : un Flow exige un WhatsApp récent, et sur un Android
bas de gamme à Douala il ne s'affiche pas. Le formulaire **s'ajoute** — pour
l'avis, il part avec la liste d'étoiles, pas à sa place.

**Les mêmes bornes que la saisie libre.** Un formulaire ne doit pas faire
entrer ce que la question refuse : ville acceptable, note entière de 1 à 5,
mot borné à 1 000 caractères. Une seule tolérance — une langue inconnue
retombe sur le français plutôt que de faire échouer une inscription entière
pour un champ de confort.

**Dormant par défaut.** Sans `WABOT_FLUX_*_ID`, le fil est exactement celui
d'avant, au caractère près. Même régime que `PAYMENT_AGGREGATOR_ENABLED`
(AGENTS.md §5).

## Un effet nouveau, et pourquoi

Le formulaire d'avis rend la note **et** le mot d'un coup, là où le chemin
question-par-question les sépare en deux étapes (`deposer_avis` puis
`completer_avis`). D'où `deposer_avis_complet` : l'avis s'écrit complet, dans
la **même** transaction. Deux effets qui se suivraient laisseraient une
fenêtre où l'avis existe sans son mot.

## Le script

`node apps/api/scripts/flux.mjs --deposer` crée, téléverse et **publie** les
trois. Trois raisons de ne pas le faire à la main :

1. un Flow se crée en **quatre** appels, trois fois de suite ;
2. **oublier la publication est l'erreur la plus coûteuse** — un Flow en
   brouillon s'envoie sans erreur et ne s'ouvre jamais ;
3. le script vérifie d'abord que chaque définition **promet les champs que le
   domaine relit**. Un champ renommé se déposerait sans erreur, s'ouvrirait
   sans erreur, et sa réponse serait refusée **en silence** : l'acheteuse
   verrait sa question se re-poser sans comprendre.

`--voir` valide hors ligne, `--etat` dit ce qui existe déjà, `--deposer` est le
seul acte sortant — et il ne part jamais tout seul.

## Ce qui reste à vérifier sur un vrai téléphone

Le domaine est écrit et testé ; la jonction avec un Flow réel ne l'est pas
encore. Trois points à regarder au premier essai à Douala :

- le jeton revient-il bien dans `response_json` ;
- `RadioButtonsGroup` rend-il l'identifiant (`"5"`) ou le titre ;
- le formulaire s'ouvre-t-il sur les téléphones du terrain.

Tant que ce n'est pas fait, les variables restent absentes, et rien ne change.

## Conséquences

- 18 tests neufs, dont celui qui compte : une réponse de livraison ne devient
  jamais un avis.
- `jetonFlux` quitte `conversation.ts` pour `flux.ts` : une seule source pour
  les trois formulaires.
- Trois variables d'environnement, absentes par défaut.

---

## Addendum du 11/08/2026 — il n'existe pas de champ de localisation

Le premier essai à Douala a validé le formulaire de livraison de bout en bout
(ville, quartier, repère, téléphone lus correctement, récapitulatif exact), et
il a révélé un défaut de composition : **le formulaire saute l'étape `details`,
donc la demande de position de l'ADR 0062 ne partait jamais** pour celles qui
remplissent en une fois — précisément la population au WhatsApp le plus récent.

Avant d'ajouter un champ de carte, la question a été **mesurée** plutôt que
supposée. Un formulaire jetable a été créé, quatre définitions candidates lui
ont été téléversées, puis il a été supprimé :

| Composant essayé | Réponse de Meta |
|---|---|
| `LocationPicker` | Invalid value found for property 'type' |
| `LocationRequest` | Invalid value found for property 'type' |
| `MapPicker` | Invalid value found for property 'type' |
| `Location` | Invalid value found for property 'type' |
| `OptIn` *(témoin)* | **accepté** |

Le témoin passe : la sonde est fiable, et le refus est réel. **Aucun composant
de localisation n'existe dans les formulaires Meta.** Le seul objet capable de
capter un point est le message natif `location_request_message`, qui vit hors
du formulaire.

### La composition retenue

Le formulaire porte une **case à cocher** — « Envoyer aussi ma position exacte
(facultatif) » —, qui est une **intention**, pas une donnée de livraison :
elle ne rejoint jamais l'objet enregistré, et un test le tient.

Cochée, la demande native part **après** le récapitulatif : l'acheteuse relit
d'abord ce qu'elle a saisi. Le point reçu ensuite s'attache et le
récapitulatif se re-montre — ce chemin existait déjà (ADR 0062), il n'a pas
fallu l'écrire.

Non cochée, rien ne part. On ne réclame pas une position que personne n'a
proposée.

### Ce que le premier essai n'a PAS tranché

L'écho du `flow_token` reste non vérifié : la branche `ville` lit la réponse
sans regarder le jeton, elle aurait donc marché dans les deux cas. Le jeton ne
devient critique qu'au premier usage du formulaire d'avis.
