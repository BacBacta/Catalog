# 0069 — Le comptoir vendeuse

Date : 2026-08-11
Statut : accepté
Applique : le rang 1 de l'ADR 0061 (« deux comptoirs, un moteur »)
Concerne : `domain/bot/comptoir-vendeuse.ts`, `domain/bot/inscription.ts`,
`domain/bot/aiguillage.ts`, `bot.ts`, `packages/contracts/src/order.ts`

## La fuite que ce rang ferme

La vente la plus fréquente au Cameroun n'est pas le self-service au prix
affiché : c'est la vente **négociée de vive voix**, conclue à un prix qui n'est
pas celui du catalogue. Cette vente-là n'entrait dans aucun moteur — ni
commande, ni preuve, ni reçu, ni statistique. Le rang 0 (ADR 0066) a fermé la
fuite côté web ; celle-ci restait ouverte au milieu du produit.

Désormais : la vendeuse écrit « vendu » dans son fil, répond à **quatre
questions**, confirme un récapitulatif — et le moteur crée la commande au
**prix convenu**, puis lui rend un message de paiement autosuffisant qu'elle
**transfère à sa cliente**. « La transaction ne change pas de mains : elle
change de pièce. »

## Les quatre faits, et pourquoi ceux-là

| fait | pourquoi lui |
|---|---|
| l'article | le libellé de la vente ; texte libre, elle sait le dire |
| le prix convenu | PAS celui du catalogue — c'est toute la raison d'être |
| le numéro de la cliente | la commande en a besoin, et le jeton de suivi aussi (voir plus bas) |
| le point de remise | `retrait` n'exige que lui et le téléphone |

Le quatrième a failli devenir un arbitrage : `Order.delivery` et
`Order.buyerPhone` sont NOT NULL, et une vente négociée n'a ni ville, ni
quartier, ni repère. **Le contrat répondait déjà** — `deliverySchema` fait du
mode `retrait` un mode de plein droit (ADR 0005 : « pas un cas dégradé »), qui
n'exige que le point convenu et le téléphone. Quatre questions, aucune
invention, aucune migration.

## Un état de la machine existante, pas une seconde machine

Le comptoir est un **état de la machine vendeuse** (`EtatVendeuse`,
discriminant `comptoir`) : même persistance (`BotConversation.etat`), même
horloge d'abandon (ADR 0048 — « deux horloges pour une seule notion d'abandon
se contrediraient un jour » ; deux persistances aussi), et mêmes protections
acquises — le SMS d'opérateur collé **traverse** sans devenir un prix (règle 0
de l'aiguillage, ADR 0052), le lien de boutique se met en pause, « annuler »
et « aide » valent partout.

L'ancrage du mot-clé est strict — `vendu`, `j'ai vendu`, `vente`, et rien qui
leur ressemble : le comptoir capture les messages **suivants**, donc l'ouvrir à
tort sur « comment vendre ? » enfermerait la vendeuse dans un formulaire
qu'elle n'a pas ouvert.

## Un seul moteur — la ligne qui compte

La création passe par `creerCommande`, **l'unique fonction du dépôt où une
commande naît**, avec une origine (`actor: vendeuse`, `canal:
comptoir_vendeuse`) qui entre au journal d'audit. Plan de paiement, référence,
code de vérification, jeton : exactement ceux du comptoir acheteuse. Écrire une
seconde fonction de création aurait fabriqué le troisième comptoir que
l'ADR 0061 interdit.

`orderItemSchema.productId` devient **optionnel** (expand) : l'article d'une
vente négociée n'existe pas toujours au catalogue, et les deux seuls
consommateurs — l'attribution d'un avis à un produit — le lisaient déjà
défensivement. Un item du comptoir acheteuse porte toujours le sien.

## Le message transféré, et le jeton qui n'y est PAS

Le message rendu à la vendeuse porte les sept informations dues (AGENTS.md
§2) : article, quantité, prix, total, boutique, référence, code de
vérification — plus le bloc de paiement, autosuffisant en texte brut (« jamais
un parcours qui exige un lien externe »).

**Il ne porte ni le jeton de suivi, ni le lien qui le contient.** Ce message
passe par les mains de la vendeuse ; le jeton autorise la contre-signature de
l'acheteuse (ADR 0021). Le lui remettre reviendrait à la laisser se
contre-signer elle-même — le contrôle n° 7, celui qui attrape « la collusion à
une seule voix », s'annulerait tout seul. La référence et le code
**identifient sans rien autoriser** ; le lien de suivi arrive à la cliente
dans **son** fil, le jour où elle écrit au bot. C'est ce qui donne au numéro de
la cliente sa raison d'être : sans lui, le moteur ne saurait pas à qui
remettre le jeton en main propre.

Sans réversement posé, rien n'est réclamé d'avance — même règle que
`sans_prepaiement` : le message dit « se règle à la remise » au lieu
d'afficher « à payer maintenant : 0 F ».

## Les congés ne bloquent PAS ce comptoir — décision, pas oubli

L'ADR 0039 ferme la boutique aux commandes que des **acheteuses** initient.
Ici, la vendeuse déclare une vente qu'elle vient de conclure : la refuser
serait Catalog disant à une vendeuse qu'elle n'a pas le droit d'avoir vendu —
et pousserait la vente hors du moteur, la fuite exacte que ce rang ferme. La
commande se crée ; le rappel congés part ensuite, comme après la carte-vitrine
(ADR 0057).

## Dit plutôt que tu

- **Le fil vendeuse est en français** (ADR 0033), donc les quatre questions
  aussi. Mais le message transféré s'adresse à la **cliente**, dont la langue
  est inconnue : il part en français seul aujourd'hui. L'anglais viendra avec
  la langue du fil vendeuse — une décision, pas un oubli.
- **Quantité fixe à 1.** « Robe wax × 3 » se déclare en trois ventes ou dans
  l'article (« 3 robes wax ») ; une question de plus à chaque vente coûterait
  plus cher que ce cas n'arrive.
- **Aucun rapprochement avec le stock** : l'article est en texte libre, et le
  stock ne se décompte pas (ADR 0038).

## Conséquences

- 27 tests de domaine + 4 d'aiguillage + 7 de bout en bout contre une vraie
  base — dont : le SMS collé ne devient jamais un prix, le jeton n'apparaît
  jamais dans le message transféré, et rien ne se crée sans « confirmer ».
- `creerCommande` prend désormais les items et l'origine ; le site d'appel
  acheteuse est inchangé dans son comportement.
- Le rang 2 (réputation à l'acompte, alerte à l'ancien numéro) reste à faire.
