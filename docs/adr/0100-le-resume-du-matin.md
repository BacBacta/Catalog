# 0100 — Le résumé du matin : le service qu'on ne demande jamais

Date : 2026-08-15
Statut : accepté
Lot : P6 de `PROMPTS-premium.md`, sous le cadrage de l'ADR 0095.
Complète : 0022 (l'honnêteté des chiffres), 0023 (rédaction des traces),
0033 (le fil vendeuse est en français), 0054 (les gabarits, liste fermée).

## Contexte

La maquette promet une carte à 07:30 : « Bonjour Bintou — hier chez vous »,
les faits, puis l'action suivante. Zéro message de la vendeuse : la journée
démarre par ce qui a bougé et ce qui reste à faire.

## Décision 1 — le silence est une sortie de plein droit

Le composeur (`domain/bot/resume-matin.ts`, pur — la date arrive en
paramètre) rend la carte **ou `null`**. Une boutique sans fait d'hier et
sans reste à faire n'envoie RIEN — pas de « rien à signaler » : un message
quotidien vide est du bruit quotidien, et le silence fait partie du service
(c'est la note de la maquette). La déduplication s'écrit MÊME pour un
silence : rejouer le jour ne re-décide pas.

Chaque ligne n'existe que si son fait existe. **Les visites n'apparaissent
que si `vuesInstrumentees` est vrai** (ADR 0022) — il est faux aujourd'hui,
la boutique statique ne compte pas ses pages vues, et le résumé ne sera pas
le premier endroit où le produit invente un chiffre. Aucune donnée de SMS
n'entre dans la carte (ADR 0023) ; les montants passent par `formatXaf`.

## Décision 2 — un écart au prompt : le résumé est en FRANÇAIS

Le prompt du lot demandait une copie FR/EN. Le résumé s'adresse à la
VENDEUSE, et le fil vendeuse est monolingue français par décision (ADR 0033
— l'espace vendeuse entier l'est). C'est le même arbitrage que la rafale
(ADR 0096) : la règle « FR + EN » vaut pour les messages acheteuse. Une
carte bilingue ici serait la demi-bascule que l'ADR 0033 refuse.

## Décision 3 — 07:30 Africa/Douala, et jamais de gabarit

Le travail pg-boss se planifie à `30 7 * * *`, fuseau `Africa/Douala` —
UTC+1 SANS heure d'été : l'heure est fixe toute l'année, et elle est écrite
en UN endroit commenté (`jobs/relance-acompte.ts`).

Hors fenêtre de service : **la carte attend le prochain entrant, jamais un
gabarit**. La liste des gabarits est fermée (ADR 0054) et l'ADR 0095 n'en a
pas accordé au résumé : un réveil facturé pour du confort est exactement ce
que la doctrine refuse — un résumé qui arrive avec le premier message de la
journée de la vendeuse arrive encore à l'heure. `notifier` porte déjà cette
politique ; le job ne fait que l'emprunter.

L'idempotence est une table : `resume_matin (seller_id, jour)` UNIQUE, en
ajout seul. Le travail relancé le même jour trouve la ligne et se tait —
même patron de reprise que la rafale et l'expiration.

## Décision 4 — l'opt-out en un mot, annoncé, réversible

La PREMIÈRE carte envoyée annonce « stop résumé ». Le mot pose
`Seller.resumeMatinStopA` (horodaté — on saura dire depuis quand) et la
confirmation annonce le mot inverse : « résumé » le remet en route. Les deux
mots entrent dans l'aiguillage (ils traversent un achat en cours, comme
« solde ») et dans `motDuModeDemploi`.

## Preuves

- `apps/api/src/domain/bot/__tests__/resume-matin.test.ts` — avec des faits
  → la carte de la maquette ; **sans faits → `null`** (la démonstration du
  lot) ; visites non instrumentées → la ligne n'existe pas ; première carte
  → l'annonce de l'opt-out ; les mots « stop résumé » / « résumé ».
- `apps/api/src/__tests__/bot-resume.test.ts` — contre une vraie base : le
  travail envoie la carte à la vendeuse active ; relancé le même jour, UN
  seul envoi ; « stop résumé » → plus rien, « résumé » → la carte revient ;
  sans faits → silence, et la déduplication s'écrit quand même.
