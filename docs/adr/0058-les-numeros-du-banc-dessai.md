# 0058 — Les numéros du banc d'essai

Date : 2026-08-10
Statut : accepté
Concerne : `banc-essai.ts`, `auth.ts`, `auth-connexion-whatsapp.ts`,
`routes/payout.ts`, `domain/payout-phone.ts`

## Ce que le banc a montré

Le banc d'essai du 10/08/2026 se tient depuis la Belgique, à deux téléphones
belges. Il a révélé une asymétrie que personne n'avait vue : une vendeuse née
dans le fil avec un numéro étranger **existe** — le bot ne valide pas le
numéro de l'expéditrice, c'est Meta qui l'atteste — mais ne peut **jamais**
entrer dans son espace. L'OTP la refuse (`phoneNumberValidator` exige +237),
et la connexion par WhatsApp l'ignore en silence (`normalizePhone` rend
`null`). Sans espace, pas de numéro de reversement ; sans reversement, toute
commande part `sans_prepaiement` ; sans prépaiement, ni rampe, ni preuve.

**La moitié paiement du produit — sa valeur numéro un — était injouable sur
le banc.** Les cases S5 et S7 du rapport, toutes vides, disent exactement ça.

## Décision — une liste nommée, vide par défaut

`BANC_ESSAI_NUMEROS_HORS_CM` : des numéros **hors Cameroun, nommés un à un**.
Un numéro listé peut se connecter (OTP et WhatsApp entrant) et servir de
numéro de reversement. Son code part par le **WhatsApp du bot**, en texte
libre — le canal normal est le SMS Orange Cameroun, qui ne livre pas en
Europe ; et le banc converse déjà avec le bot, sa fenêtre est ouverte.

Le régime est celui de `PAYMENT_AGGREGATOR_ENABLED` (AGENTS.md §5) :

- **absente, rien ne change nulle part** — la règle +237 est exactement celle
  d'avant, au caractère près ;
- la production ne la pose **jamais** ;
- un +237 listé est **ignoré** : le chemin normal ne se court-circuite pas,
  et l'y glisser masquerait une régression de la vraie porte.

## Comment la règle entre sans toucher au contrat

`packages/contracts` n'est pas modifié : `normalizePhone` reste la règle du
produit. Dans le domaine, `appliquerChangementReversement` reçoit désormais
sa règle de forme **en paramètre, défaut = celle du produit** — l'injection
qui vaut déjà pour le temps et l'aléa (AGENTS.md §4). La décision, elle, ne
bouge pas d'une ligne : vérification du même numéro, fenêtre de validité,
journal d'audit écrit dans tous les cas, refus compris.

Les couches d'entrée (`auth.ts`, `payout.ts`, `auth-connexion-whatsapp.ts`)
élargissent leur validation aux numéros du banc, et rien d'autre.

## Ce que cet ADR ne permet PAS

- Un numéro de banc **n'améliore pas** la preuve : le contrôle de
  contrepartie (n° 3) verra un numéro qui ne correspond pas — un
  avertissement, comme le contrat l'exige, jamais un rejet.
- L'opérateur d'un numéro de banc est indéterminé : la rampe n'affiche pas de
  code USSD pour lui, et c'est le comportement voulu pour tout préfixe
  inconnu (lot 9).
- Les limites de débit s'appliquent aux numéros du banc comme aux autres.

## Le jour où le banc est fini

Retirer la variable suffit. Le code peut rester : sans liste, chaque garde
revient à `normalizePhone` seul, et les six tests de `banc-essai.test.ts`
tiennent la propriété « liste vide = comportement d'avant ».
