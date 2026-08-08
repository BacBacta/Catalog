# 0055 — Le Flow de livraison, écrit mais dormant

Date : 2026-08-08
Statut : accepté
WABA-2 — partiel, et l'ADR dit exactement jusqu'où

## Ce qui a été mesuré avant d'écrire une ligne

L'API de notre clé 360dialog **n'expose que deux points d'entrée** : les
gabarits (`/v1/configs/templates`) et la configuration de réception
(`/v1/configs/webhook`). Tout le reste rend 404 — `/v1/configs/flows`,
`/v2/flows`, `/v1/flows`, `phone_numbers`, `business_profile`.

**Un Flow ne peut donc être ni créé ni testé depuis le dépôt.** Il se dépose
dans le Hub 360dialog ou le Flow Builder de Meta, à la main.

C'est la raison d'être de cet ADR : dire ce qui est vérifié et ce qui ne l'est
pas, plutôt que de livrer une intégration qui *semble* faite.

## Décision 1 — le domaine s'écrit, la jonction attend

Trois choses sont écrites et testées :

- **le lecteur d'une réponse** (`lireReponseFlux`) : du JSON vers une livraison
  conforme au schéma du produit ;
- **le message qui ouvre le Flow** (`messageFlux`) ;
- **la reconnaissance de `nfm_reply`** dans le parseur d'entrées — sans quoi
  une réponse de Flow tombait dans « forme non lue ».

Ce qui n'est pas vérifié : que le Flow réel rende exactement ces champs. C'est
le même régime que les raccourcis USSD (`verifie: false`, AGENTS.md §2) et que
l'adaptateur agrégateur (§5) — **écrit, compilable, inatteignable**.

Rien n'appelle ce module tant que `WABOT_FLUX_LIVRAISON_ID` est absent, et il
l'est par défaut.

## Décision 2 — les noms de champs sont un CONTRAT, tenu par un test

`docs/flux-livraison.json` est la définition à coller chez Meta. Elle est
**générée** depuis `CHAMPS_FLUX`, et un test vérifie que les deux coïncident.

Sans ce test, changer un nom d'un côté casserait la lecture de l'autre **en
silence** : la réponse arrive, aucun champ ne correspond, `lireReponseFlux`
rend `null`, et rien ne dit pourquoi.

Le même test vérifie que tous les champs sont obligatoires — une livraison
partielle n'est pas livrable — et qu'aucun ne s'appelle « adresse ». Le *mot*
apparaît en revanche dans un texte d'aide (« c'est ce qui remplace
l'adresse »), et c'est la bonne formulation : l'interdit d'AGENTS.md §2 porte
sur un champ, pas sur le vocabulaire.

## Décision 3 — le chemin question-par-question RESTE

Ce n'est pas une précaution transitoire. Un Flow exige un WhatsApp récent ; sur
un Android bas de gamme à Douala, il ne s'affiche pas. **La saisie libre est le
seul chemin qui marche partout.**

Le Flow est un raccourci pour celles qui peuvent l'ouvrir, jamais un
remplacement. L'audit du 07/08/2026 le disait déjà.

## Ce que le lot a corrigé en chemin

`normalizePhone` refusait `00237…` — la forme composée depuis un fixe, qui
circule. Le bot la tolérait de son côté depuis l'ADR 0051 : le même numéro
passait donc par un chemin et pas par l'autre. Corrigé à la source, dans les
contrats.

## Ce qui reste à faire, et par qui

1. **Déposer le Flow** — `docs/flux-livraison.json`, dans le Hub 360dialog ou
   le Flow Builder. Acte manuel, sur le compte du porteur.
2. **Poser `WABOT_FLUX_LIVRAISON_ID`** avec l'identifiant rendu.
3. **Brancher l'envoi** dans l'état `ville` ou `mode` — quelques lignes, mais
   qui n'ont aucun sens tant que 1 et 2 ne sont pas faits.
4. **Vérifier sur un téléphone réel**, à Douala, sur un Android bas de gamme.
   C'est la seule vérification qui compte, et elle ne se fait pas d'ici.

Tant que ces quatre points ne sont pas faits, le parcours acheteuse est
strictement celui d'aujourd'hui.

## Conséquences

- 14 tests neufs, vus rouges d'abord. 967 tests API.
- Une réponse de Flow qui arriverait sans que le Flow soit branché reçoit une
  phrase — « je ne sais pas encore lire ce type de message » — jamais un
  silence (ADR 0049).
- Le test qui lit `docs/flux-livraison.json` vit dans `src/__tests__`, pas dans
  `src/domain` : le domaine ne touche pas au système de fichiers, et son
  garde-fou l'a rappelé pendant l'écriture de ce lot.
