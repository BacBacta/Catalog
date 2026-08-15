# Audit du pipeline Catalog — 2026-08 (v2)

*Conduit le 15/08/2026 sur la branche courante, selon le protocole v2 du
13/08/2026. Cet audit **remplace** l'audit du 07/08
(`docs/analyses/2026-08-07-audit-integral-du-bot.md`) — il ne le prolonge pas.
Ce qui distingue cette version : un **harnais exécutable** versionné dans
`pnpm test`, une **couverture calculée** et non déclarée, et une
**vérification adverse** de chaque constat avant qu'il n'entre ici. Un constat
réfuté a disparu de ce rapport.*

---

## 1. Le verdict en cinq lignes

Les lots issus de l'audit v1 (ADR 0049 à 0053, puis 0082 à 0088) **ont tenu** :
rejoué au harnais, le domaine conversationnel ne contient **aucune cellule
muette** sur 119 cases étape × geste, les cinq bloquants de la v1 sont fermés,
et les gestes non ambigus traversent bien les formulaires. Ce qui reste n'est
plus une couche cassée : ce sont **des pièges de bord reproduits par
exécution** (sept, dont deux contredisent un commentaire ou un ADR), **des
promesses non branchées** (l'expiration de commande, la sauvegarde planifiée),
et **une écriture d'argent non atomique** — le seul constat de la famille
« corruption » qui survive à la vérification adverse.

## 2. La méthode, et ce qui la rend vérifiable

- **Phase 1 — cartographie** : six agents en parallèle, quinze couches, rendu
  structuré (points d'entrée, invariants avec `tenuPar: base|code|rien`,
  chemins d'échec avec `ditALUtilisateur`/`journalise`, zones non lues
  déclarées). Les cartes sont l'annexe de travail de ce rapport.
- **Phase 2 — le harnais** : `apps/api/src/domain/bot/__tests__/harnais.ts`.
  Il pilote les machines PURES de production (aiguillage compris), rejoue la
  mince couche de service de `bot.ts` (démarrages de fil, expirations,
  dégradation des formes pour les fils vendeuse), et rend trois choses : le
  journal des messages émis, des **instantanés lisibles en diff**
  (`__instantanes__/`), et un **compteur de couverture** étape × geste.
  Déterministe : l'horloge est un paramètre, et `domaine-pur.test.ts` balaie
  aussi ces fichiers.
- **Phase 3 — simulation** : la matrice complète
  (`harnais-matrice.test.ts`) : chaque état × quatorze gestes (texte juste et
  hors-sujet, anglais, bouton et liste périmés, photo avec et sans légende,
  vocal, sticker, localisation, Flow valide et tronqué, menu, annuler), plus
  les gestes propres au fil vendeuse (SMS entier, SMS tronqué, solde, congés,
  remise).
- **Phase 4 — vérification adverse** : trois agents indépendants chargés de
  RÉFUTER chaque constat candidat sous trois angles (reproduction, garde
  ailleurs dans le code, décision produit déjà actée). Statuts : CONFIRMÉ,
  PLAUSIBLE, DÉCISION (écarté comme défaut, listé comme décision), RÉFUTÉ
  (absent de ce rapport).

## 3. La couverture, calculée

Tableau rendu par le harnais (`__instantanes__/couverture.txt`), recalculé à
chaque `pnpm test` :

| Machine | Cases possibles | Cases exercées | % | Non exercées |
|---|---|---|---|---|
| acheteuse (9 états × 7 genres) | 63 | 63 | **100 %** | — |
| inscription (7 états × 7 genres) | 49 | 49 | **100 %** | — |
| vendeuse (fil sans état) | 7 | 6 | **86 %** | `(repos)×image` |

La case non exercée est **structurelle**, pas un trou : une photo envoyée par
une vendeuse au repos part au fil *inscription* par la règle 3 de
l'aiguillage — la cellule est donc injouable côté fil vendeuse, et le tableau
le dit plutôt que d'arrondir à 100 %.

Ce que la matrice observe, au-delà du comptage
(`__instantanes__/matrice.txt`, 241 lignes) :

- **0 cellule muette.** L'ADR 0049 (« le bot ne se tait plus ») tient à
  l'exécution, sur toutes les formes, dans tous les états.
- Toutes les cellules « geste périmé / forme inattendue » répondent
  interactivement (boutons ou liste), sauf les 23 cellules « texte nu »
  énumérées dans l'instantané — dont l'essentiel est la phrase « forme non
  lue » servie sans re-proposer le geste de l'état courant (voir C-09).
- Les couches non conversationnelles (2, 5-15) sont couvertes par la suite
  existante (1 496 tests verts, contraintes SQL éprouvées contre un vrai
  PostgreSQL en CI) et par la cartographie ; leurs constats ci-dessous portent
  chacun le test qui échouerait aujourd'hui.

## 4. Les constats confirmés

Chaque constat a survécu à la vérification adverse. Format : famille,
verdict, reproduction, sévérité **calculée** (impact × fréquence ×
détectabilité inversée, §6 du protocole). Les reproductions C-01 à C-07 sont
**exécutées** et versionnées dans `harnais-matrice.test.ts` — corriger l'un
d'eux fait échouer sa reproduction, qui devient alors le test de non-retour.

<!-- SECTION-CONSTATS : assemblée après la phase adverse -->

## 5. Ce qui a été éprouvé et qui TIENT

L'audit doit dire ce qui va, sinon la liste des défauts ment par omission.
Vérifié par exécution ou par les gardes de la CI :

- Les **sept contrôles de preuve** : ordre des motifs verrouillé par test, le
  SMS d'émission seul plafonne à « accepté sous réserve », l'identifiant
  rejoué est tranché par la contrainte UNIQUE et non par un `if`, le montant
  de séparateurs seuls lève (ADR 0019), le SMS brut est chiffré et absent de
  toute trace (suite `traces-sans-sms` sur un vrai provider OTel).
- L'**argent** : `splitDeposit` préserve le total au franc près (propriété
  sur 10 000 montants), toutes les colonnes `_xaf` sont `integer` en base,
  le montant Orange à décimales est ramené à l'entier à l'analyse.
- Le **récapitulatif avant commande** : `creer_commande` ne sort que de
  `recap` sur « Confirmer » explicite ; « confirmer » tapé dans le tunnel est
  inerte (rejoué au harnais) ; congés et stock re-vérifiés à l'écriture.
- L'**aiguillage** : le SMS collé traverse un formulaire en cours sans le
  détruire (rejoué) ; le lien de boutique se met en pause et s'arbitre.
- La **rampe** : un seul fichier de codes USSD, garanti par un test qui se
  teste lui-même ; `%23` vérifié ; aucun code de repli en dur côté boutique.
- L'**idempotence** des entrants par contrainte PRIMARY KEY (ADR 0040), la
  **file de notifications** en ajout seul qui ne perd rien, la restauration
  qui **refuse** `DATABASE_URL` par trois verrous distincts.
- La **rédaction d'observabilité** : liste fermée d'attributs,
  `recordException` neutralisé à la source, aucune auto-instrumentation, le
  canari qui rejoue la spécification chaque jour en CI.

## 6. Le plan de lots

<!-- SECTION-PLAN : assemblée après la phase adverse -->

## 7. Annexes

- Harnais : `apps/api/src/domain/bot/__tests__/harnais.ts` (+ `-parcours`,
  `-matrice`), instantanés sous `__instantanes__/`.
- Les cartes de couches (phase 1) et les verdicts adverses (phase 4) sont
  résumés dans les constats ; leurs `zonesNonLues` déclarées ont borné ce que
  ce rapport affirme.
- « Je n'ai pas mesuré » reste un résultat : les capacités Meta non mesurées
  (§8 du protocole) n'ont fait l'objet d'aucune affirmation nouvelle ici.
