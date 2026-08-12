# 0075 — On pose ce qui est publié, sans nommer les formulaires

Date : 2026-08-12
Statut : accepté
Prolonge : 0074, 0071

## Contexte

La séquence de l'ADR 0074 a été jouée le 12/08/2026 et elle aboutit :
`WHATSAPP_WABA_ID` posée, puis `poser-flux-inscription`. La première
interrogation de Meta depuis la machine apprend une chose qu'aucun de nous ne
savait : **les trois formulaires existent et sont tous `PUBLISHED`.**

| Formulaire | Statut | Identifiant |
|---|---|---|
| `catalog_livraison` | PUBLISHED | 4521530501458065 |
| `catalog_inscription` | PUBLISHED | 2262764424546659 |
| `catalog_avis` | PUBLISHED | 1377188850409808 |

Or l'opération ne posait que le premier — son `awk` cherchait littéralement
`catalog_inscription` et `WABOT_FLUX_INSCRIPTION_ID`. Les deux autres Flows
étaient publiés chez Meta et dormants chez nous, ce qui est le pire des deux
mondes : le travail de dépôt est fait, et rien n'en sort.

## Décision

**Le pas ne connaît aucun nom de formulaire. Il pose ce que `--etat` déclare
publié.** L'opération devient `poser-flux` : elle lit la sortie de
`flux.mjs --etat`, retient chaque ligne `WABOT_FLUX_..._ID=` dont le statut qui
précède disait `PUBLISHED`, et les pose toutes en un seul `flyctl secrets set`
— donc un seul redémarrage.

La liste des formulaires vit dans `flux.mjs`, et là seulement. Un quatrième
formulaire, un jour, ne se paiera pas dans le workflow.

**Un Flow absent ou en brouillon est sauté, pas fatal.** C'est le changement de
comportement à connaître : l'ancienne opération échouait si `catalog_inscription`
n'était pas publié. La nouvelle n'échoue que si **rien** n'est posable. La règle
de fond ne bouge pas d'un pouce — *seul un Flow PUBLISHED se pose*, parce qu'un
brouillon s'envoie sans erreur et ne s'ouvre jamais — mais elle ne prend plus en
otage les formulaires qui, eux, sont prêts.

`poser-waba`, lui, ne change pas.

## Sur le nom

L'ADR 0074 décrit la séquence `poser-waba` puis `poser-flux-inscription`. Ce
second nom n'existe plus ; **l'ADR 0074 n'est pas réécrit pour autant** — il dit
ce qui était vrai le jour où il a été écrit, et c'est sa fonction. La séquence à
jour est ici.

## Ce que ça ouvre, et qu'il faut voir venir

Poser `WABOT_FLUX_LIVRAISON_ID` et `WABOT_FLUX_AVIS_ID` n'est pas un geste
d'infrastructure : cela **allume deux formulaires dans le fil**. La livraison se
proposera « en une fois » à côté des questions (ADR 0055), et l'avis s'ouvrira en
formulaire. Les deux s'ajoutent, aucun ne remplace le chemin question par
question — un Flow ne s'affiche pas sur un WhatsApp ancien, et l'Android bas de
gamme est notre population, pas un cas limite.

C'est en préproduction, et c'est réversible : retirer le secret rend le chemin
d'avant, sans redéploiement.
