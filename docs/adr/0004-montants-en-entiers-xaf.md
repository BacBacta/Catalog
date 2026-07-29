# 0004 — Tous les montants sont des entiers XAF

- Statut : accepté
- Date : 2026-07-28

## Contexte

Le franc CFA n'a pas de sous-unité. Représenter un montant en flottant ou en
décimal ouvre la porte aux erreurs d'arrondi sur un produit dont la valeur
centrale est la **preuve de paiement opposable** : un écart d'un franc entre le
reçu de l'acheteuse et le relevé de la vendeuse détruit la confiance que le
produit est censé fabriquer.

## Décision

Tous les montants sont des **entiers**, suffixés `_xaf`, du schéma de base
jusqu'à l'affichage. Aucun flottant, aucun `decimal`, aucune division sans
arrondi explicite et testé.

Répartition d'un acompte : l'acompte est arrondi au franc **inférieur**, le
solde absorbe le reste. Un acompte de 50 % sur 7 501 F donne 3 750 F et 3 751 F.

## Conséquences

- `splitDeposit()` dans `packages/contracts` est la seule implémentation
  autorisée, couverte par un test de propriété sur 10 000 montants aléatoires.
- La contrainte `amountPaidXaf + balanceXaf = totalXaf` est appliquée par la
  base, pas par le code applicatif.
