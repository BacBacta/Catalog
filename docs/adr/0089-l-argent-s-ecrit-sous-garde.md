# ADR 0089 — L'argent s'écrit sous garde, et un blocage se dit

Date : 2026-08-15
Statut : accepté
Issu de : l'audit de pipeline v2 (`docs/audit-pipeline-2026-08.md`), constats
A1 et A5, confirmés par vérification adverse et reproduits par test contre
une vraie base.

## Contexte — deux défauts d'une même lecture

Les trois écritures d'argent du produit — la preuve soumise par l'app, la
même par le fil WhatsApp (ADR 0083), la déclaration manuelle — suivaient le
même mouvement : **lire la commande hors transaction, calculer, écrire des
valeurs absolues dans la transaction**. Aucun verrou, aucune version.

1. **Le dernier écrit gagnait, en silence (A1).** Deux versements différents
   et rapprochés — l'acompte collé dans le fil pendant que le solde se
   déclare dans l'app — s'écrasaient : `order.amount_paid_xaf` ne reflétait
   que le second, la contrainte `CHECK` restait satisfaite (chaque paire
   écrite est cohérente), et seul le journal comptable en ajout seul gardait
   les deux lignes. Divergence détectable a posteriori, signalée nulle part.
2. **Un blocage se lisait « accepté » (A5).** Sur une commande contestée, un
   SMS valide écrivait la preuve, la machine refusait la transition
   (`litige_ouvert`) — et les deux surfaces annonçaient « le reçu est émis »,
   alors que l'émission est précisément refusée sur `conteste`. Le refus
   n'était visible que dans `order_event`.

## Décision 1 — relire dans la transaction, écrire sous garde

`soumettrePreuve` relit la commande **dans** la transaction et compare à
l'instantané qui a servi aux contrôles : s'ils divergent, **tout est défait**
— la preuve comprise, donc l'identifiant d'opérateur reste libre — et le
résultat est une issue à part entière, `commande_modifiee`. L'écriture des
montants est de plus gardée par la valeur lue (`updateMany … where
amountPaidXaf = <lu>`) : sous concurrence réelle, la seconde transaction
attend le verrou de ligne, revoit la valeur commise, ne correspond plus, et
échoue proprement au lieu d'écraser. La déclaration manuelle porte la même
garde.

C'est la philosophie de l'ADR 0040 appliquée à l'argent : **plutôt perdre une
soumission — recollable à l'identique — que d'écraser un versement.** Les
surfaces le disent en langue simple : « La commande a changé pendant la
vérification… Recollez le SMS : rien n'a été perdu. »

On n'a PAS choisi `SELECT FOR UPDATE` ni un niveau d'isolation global : la
garde optimiste suffit ici (le conflit est rare, la reprise est un collage),
et elle n'ajoute ni attente de verrou sur le chemin nominal ni dépendance à
un comportement de pilote.

## Décision 2 — le résultat porte l'avancée, et les surfaces la disent

`ResultatPreuve` expose désormais `transitionOk` **et** `transitionRaison`.
La route les rend (`transitionOk`, `blocage`), l'écran de collage distingue
« prouvé, reçu émis » de « les contrôles passent, mais la commande est en
litige : rien n'a avancé », et `messageVerdict` du fil a la même bouche.
Un verdict et une transition sont deux faits ; les confondre faisait mentir
le produit sur sa valeur n° 1.

## Ce que cela ne change pas

- Un même SMS soumis deux fois reste tranché par la contrainte UNIQUE
  (contrôle n° 5) — la garde ne s'y substitue pas, elle couvre les
  versements *différents*.
- Le journal comptable reste la vérité reconstructible ; la garde évite
  simplement que `order` s'en éloigne.
- « Accepté sous réserve » garde son message propre : `transitionOk: false`
  y était déjà le comportement documenté.

## Preuves

- `apps/api/src/__tests__/preuve-route.test.ts` — « l'argent s'écrit sous
  garde » : la soumission sur instantané périmé rend `commande_modifiee`,
  n'écrit rien, laisse l'identifiant libre ; « litige » : `transitionOk:false`
  et `blocage:"litige_ouvert"` sur les deux surfaces. Exécutés contre une
  vraie base (1 499 tests verts, zéro sauté).
