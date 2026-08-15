# ADR 0094 — L'acompte dû se fige à la création

Date : 2026-08-15
Statut : accepté
Issu de : l'audit de pipeline v2 (`docs/audit-pipeline-2026-08.md`), constat
A4 (sévérité 20, corruption latente) — le montant d'acompte dû n'était
persisté nulle part.

## Contexte — un attendu qui bougeait avec le code

`POURCENT_ACOMPTE_DEFAUT` (50) vit dans `domain/order/paiement.ts`, et tout
le monde recalculait depuis elle : la création de commande, le contrôle n° 2
de la preuve, la relance d'acompte. Tant que la constante ne bouge pas,
c'est invisible. Le jour où un commit la change — décision produit tout à
fait plausible, `planDePaiement` accepte déjà un pourcentage par commande —
l'attendu de TOUTES les commandes acompte impayées change rétroactivement :
une acheteuse à qui le produit a demandé 50 % hier, et dont le SMS est en
route, se ferait refuser par le contrôle n° 2 (« il en manque X sur les
Y attendus ») pour un paiement exactement conforme à ce qu'on lui a demandé.

C'est la définition de la corruption latente : aucun défaut aujourd'hui, un
mensonge arithmétique le jour du changement.

## Décision — une colonne, écrite une fois, lue partout

**Expand** : `order.due_before_xaf`, entier nullable
(migration `20260815100000_acompte_du_fige`).

- **Écrite à la création, jamais après** : `creerCommande` (bot, les deux
  comptoirs — l'unique moteur) y fige `plan.duAvantXaf`. Zéro en
  `sans_prepaiement` est un zéro ÉCRIT, pas un nul : « rien n'était dû »
  est une information, « on ne sait pas » en est une autre.
- **Lue par le contrôle n° 2** (`soumettrePreuve`) : tant que rien n'est
  arrivé, l'attendu est le montant figé ; dès qu'un versement est passé,
  l'attendu redevient le solde — logique inchangée de l'ADR 0035.
- **Lue par la relance d'acompte** : elle redit le montant que la commande a
  demandé, pas ce que la constante vaut le jour de l'envoi.

**Le recalcul ne subsiste que pour les commandes d'avant la colonne**
(`due_before_xaf` nul) : pour elles, la constante est la seule vérité
disponible, et c'est le sens du nullable — une migration expand ne réécrit
pas l'histoire, elle cesse d'en dépendre pour la suite. La phase *contract*
(rendre la colonne obligatoire) attendra que ces commandes soient toutes
sorties de la fenêtre de 48 h.

## Ce que ce lot NE change pas

- La règle d'arrondi reste `splitDeposit` (floor sur l'acompte, AGENTS.md
  §2) — la colonne en stocke le résultat, elle ne la remplace pas.
- Aucun pourcentage par commande n'est exposé à la vendeuse : le paramètre
  de `planDePaiement` existe, l'interface pour s'en servir est une décision
  produit non prise.
- Le récapitulatif AVANT création (`conversation.ts`) recalcule toujours :
  il n'existe pas encore de commande où lire, et c'est le même instant que
  l'écriture.

## Preuves

- `apps/api/src/__tests__/preuve-route.test.ts` — une commande née sous un
  acompte d'un tiers accepte le SMS du montant DEMANDÉ (le recalcul à 50 %
  l'aurait refusé) ; une commande d'avant la colonne recalcule.
- `apps/api/src/__tests__/bot-comptoir.test.ts` — la création fige 6 250 F
  sur 12 500, et un zéro écrit en `sans_prepaiement`.
- `apps/api/src/domain/bot/__tests__/relance.test.ts` — la relance redit le
  montant figé, et recalcule pour les seules commandes sans colonne.
