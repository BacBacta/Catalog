# 0101 — L'avis en Flow : un lot déjà livré, fermé par ses preuves

Date : 2026-08-15
Statut : accepté
Lot : P7 de `PROMPTS-premium.md`, sous le cadrage de l'ADR 0095. C'est le
dernier lot de la séquence premium.
Complète : 0036 (l'identité du fil), 0055 (les Flows), 0063 (trois
formulaires, un seul passage), 0076 (distribution des avis).

## Constat — l'essentiel du lot existait avant lui

Le prompt P7 a été écrit avant que les lots hors séquence ne livrent le
formulaire d'avis. Au moment d'ouvrir le lot, l'inventaire donne :

- **le Flow existe et est déposé** : `docs/flux-avis.json` (un écran, note
  obligatoire en 1..5, mot facultatif), `catalog_avis` dans le registre de
  `flux.mjs`, identifiant posé le 13/08/2026 (`WABOT_FLUX_AVIS_ID`,
  mesures de l'ADR 0087) ;
- **le lecteur existe** : `lireAvisFlux` — note ENTIÈRE bornée 1..5, mot
  borné comme la saisie libre (ADR 0063) ;
- **le branchement existe** : à la remise, l'invitation à noter part
  (gabarit `commande_livree` hors fenêtre — ADR 0054) ; « Donner mon avis »
  sert le formulaire EN PLUS de la liste d'étoiles, qui reste le chemin qui
  marche partout (doctrine ADR 0055/0063) ;
- **la distribution ne change pas** : boutique et fiche article
  (`Review.productId`) — ADR 0076.

Ce lot ferme donc ce qui manquait : le test miroir du contrat de champs
(`flux-spec.test.ts` ne couvrait ni l'avis ni son unicité d'écran), et les
deux tests de garde du chemin Flow.

## Décision 1 — la garde est celle du produit, dite précisément

Le prompt écrivait « l'avis n'est recevable que sur un achat vérifié ». La
règle LIVRÉE et testée est plus fine, et elle est la bonne (lot 12,
ADR 0036) : **l'avis est possible dès que la commande est livrée ;
« vérifié » est un LABEL**, réservé aux paiements prouvés
(`droitAuDepot` → `peutDeposerAvisVerifie`). Un dépôt direct déclaré à la
main donne un avis publié mais non vérifié, qui n'entre pas dans la note —
on ne l'empêche pas, on le distingue.

Ce que P7 exigeait vraiment — **le Flow ne crée pas un chemin qui contourne
la vérification** — est tenu : la réponse du formulaire passe par la MÊME
porte (`avisPossible`, `avisDejaDepose`) que la liste d'étoiles, et deux
tests le tiennent désormais (commande non livrée → refus ; avis déjà déposé
→ refus).

## Décision 2 — un avis re-soumis est REFUSÉ, pas remplacé

Le prompt proposait « un avis re-soumis remplace le précédent ». Non
retenu : l'unicité (`UNIQUE(order_id)`) et le refus courtois sont la
conception établie et testée (ADR 0036 — « un second avis est refusé par la
base, sans casser la conversation »), et le remplacement rouvrirait des
questions que personne n'a arbitrées : une note recalculée en silence, un
label « vérifié » qui voyage d'un texte à l'autre, une réputation qui bouge
sans trace. L'INTENTION du prompt — l'idempotence, un avis ne s'additionne
jamais — est déjà tenue. Le mot, lui, reste enrichissable après coup
(`completer_avis`), et c'est le seul « remplacement » permis.

## Ce que ce lot NE fait pas

- L'invitation à la remise reste en deux gestes (bouton « Donner mon avis »
  → formulaire) : une notification à boutons ne porte pas de bouton de Flow,
  et le gabarit hors fenêtre encore moins. Le geste supplémentaire est le
  prix de la fenêtre, pas un oubli.
- La liste d'étoiles n'est pas retirée : le formulaire s'AJOUTE, il ne
  remplace pas (doctrine constante depuis l'ADR 0055).

## Preuves

- `flux-spec.test.ts` — le contrat de champs de `docs/flux-avis.json` : un
  écran, `note` obligatoire aux identifiants 1..5, `mot` facultatif.
- `flux-trois.test.ts` — **le refus sur commande non livrée via le Flow**
  (la démonstration du lot), le refus sur avis déjà déposé, la note et le
  mot en un effet, la non-confusion avec la livraison.
- `bot-apres-achat.test.ts` (existant) — l'avis vérifié vs non vérifié, le
  second avis refusé par la base.

## La séquence premium est close

P0 à P7 sont livrés (ADR 0095 à 0101). Restent, par décision et non par
oubli : les étages 2 et 3 (catalogue natif Meta, numéro dédié) qui attendent
l'ADR de pricing du porteur, et les vérifications qui ne se font pas d'ici —
les Flows sur un téléphone réel à Douala, les budgets depuis un vrai réseau
camerounais.
