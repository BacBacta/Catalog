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

Sévérité = impact × fréquence × détectabilité inversée (1-5 chacun).
**Corrigé dans ce lot** = le remède est dans le même commit que ce rapport,
avec son test de non-retour exécuté contre une vraie base.

### 4.1 Corrigés dans ce lot

| Id | Couche | Famille | Constat (reformulé après l'épreuve adverse) | Sév. | Non-retour |
|---|---|---|---|---|---|
| **A1** | 6-argent | corruption | Les trois écritures d'argent lisaient hors transaction puis écrivaient des valeurs absolues : deux versements différents concurrents se remplaçaient en dernier-écrit-gagne, CHECK satisfait, seul le grand livre gardait les deux lignes. | 5×2×5=**50** | `preuve-route.test.ts` « l'argent s'écrit sous garde » — ADR 0089 |
| **A5** | 7-preuve | faux | Sur une commande contestée, un SMS valide écrivait la preuve, la machine refusait (`litige_ouvert`) — et l'écran disait « le reçu peut être émis », le fil « le reçu est émis », alors que l'émission est refusée sur `conteste`. | 4×2×4=**32** | `preuve-route.test.ts` « litige » ; `transitionOk`+`blocage` exposés — ADR 0089 |
| **B3** | 2-transport | corruption | Le fail-open d'idempotence (`.catch(() => true)`) faisait TRAITER les relivraisons pendant une panne de base, sans trace — en contradiction frontale avec le compromis écrit de l'ADR 0040. | 4×2×5=**40** | fail-closed journalisé (`bot.ts`) |
| **D2** | 9-médias | muet | Un JPEG tronqué à signature valide (téléchargement CDN interrompu) faisait échouer TOUTE la publication dans le fil — pas d'article, « panne passagère », nom et prix reperdus — contra l'invariant écrit et sans la parité du chemin HTTP. | 4×2×4=**32** | `bot-flux-article.test.ts` « JPEG tronqué » |
| **B2** | 13/14-ops | silence | Aucun arrêt propre : `jobs.arreter()` et `arreterObservabilite()` écrits, commentés « à appeler avant un arrêt propre », appelés par personne — spans en lot perdus à chaque redéploiement. (Les trois autres sous-points de B2 : réfutés — journal existant, décision commentée, retry pg-boss par défaut.) | 2×5×3=**30** | gestionnaire SIGTERM/SIGINT (`server.ts`) |
| **D7** (C-02) | 4-machines | impasse | `avis_mot` mangeait les mots-clés globaux : « menu » ou « annuler » partaient en COMMENTAIRE d'avis, irréversiblement — le commentaire du code affirmait l'inverse, et les états frères honorent « menu ». | 3×3×3=**27** | C-02 (harnais) |
| **C-05** | 4-machines | impasse | Stock tombé à zéro après l'entrée en quantité : « Écrivez un nombre jusqu'à 0 » en boucle — la garde n'existait qu'à l'entrée. | 3×2×3=**18** | C-05 (harnais) |
| **C-06** | 4/7 | devinette | Un SMS tronqué collé dans le fil recevait la carte générique — qui invitait… à coller un SMS — sans dire que celui-ci n'était pas reconnu ; la route HTTP expliquait déjà. | 3×3×2=**18** | C-06 (harnais) |
| **D1** (résidu) | 1-acquisition | mensonge | La consigne du pack Statut promettait « les commandes venues de votre Statut se compteront à part » — le canal est marqué mais compté nulle part (report acté ADR 0066), et l'écran des chiffres dit l'inverse. Copie corrigée. | 3×3×2=**18** | copie sans promesse (`pack-statut.ts`) |
| **D5** | 8-rampe | muet | L'îlot `/payer` mourait au rendu sur un numéro non normalisable (URL éditée, ou reversement étranger du banc d'essai ADR 0080) — aucun état d'erreur, contra les quatre états exigés. | 3×1×4=**12** | `lireParametres` refuse → écran « lien incomplet » |

Et une correction sur l'auditeur lui-même : **D6 est un faux constat produit par
le harnais** — sa couche de service ne rejouait pas la garde `bot.ts:614-637`
(« ajouter » à froid reçoit la question, il n'entre jamais dans la machine).
La vérification adverse l'a attrapé ; le harnais est réaligné et C-01 réécrit
sur le résidu réel : *dans* `article_nom`, les mots du mode d'emploi
(« vendu », « ajouter ») deviennent le nom — famille ADR 0048, non corrigé
(voir le plan).

### 4.2 Confirmés, à corriger par lots (§6)

| Id | Couche | Famille | Constat | Sév. |
|---|---|---|---|---|
| **A2** | 13-jobs | mensonge | L'expiration de commande n'existe pas : `expiresAt` écrit jamais relu, `etatExpiration` sans appelant, aucun état cible dans le schéma, aucun job — pendant que la relance d'acompte DIT aux acheteuses « Sans acompte, la commande expirera d'elle-même » (FR et EN). | 4×4×4=**64** |
| **B4** | 2-transport | silence | `value.statuses` (dont `failed` asynchrone et ses codes d'erreur) n'est cueilli nulle part, sans ADR — un numéro bloqué ou un message refusé après le 200 est invisible. Atténué par le calcul de fenêtre côté Catalog (ADR 0060). | 3×3×5=**45** |
| **D4** | 9-médias | silence | Zéro compteur/span sur toute la couche média : une panne du CDN Meta produit des articles sans photo en série, indistinguable en agrégat de vendeuses qui n'envoient pas de photos. | 3×2×5=**30** |
| **B5** | 10-sortie | silence | Un 5xx Meta transitoire perd définitivement une réponse de conversation : pas de retry, pas de file (réservée aux notifications), et `termineLe` posé même après échec interdit le rattrapage par relivraison. Journalisé, mais aucun ADR n'acte le choix. | 3×2×4=**24** |
| **A4** | 6-argent | corruption latente | Le montant d'acompte dû n'est persisté nulle part : recalculé à chaque lecture depuis `POURCENT_ACOMPTE_DEFAUT` (constante de code). Un commit qui la change modifie rétroactivement l'attendu des commandes acompte impayées — un SMS de 50 % en route serait refusé par le contrôle n° 2. | 4×1×5=**20** |
| **D3** | 9-médias | devinette | Quand un refus de validation survient dans le fil (photo de Flow, fichier vide/trop gros), la vendeuse lit « Sans photo pour l'instant » sans la cause — les messages exacts existent (`MESSAGE_REFUS_IMAGE`) et sont servis côté HTTP. Portée étroite : WhatsApp transcode. | 3×2×3=**18** |
| **C-01** (résidu D6) | 4-machines | devinette | Dans `article_nom`, les mots que le mode d'emploi enseigne (« vendu », « ajouter ») deviennent le nom de l'article. | 3×2×3=**18** |
| **C-04** | 4-machines | impasse | Au comptoir, « corriger » au récap perd les quatre faits (article, prix, cliente, remise) — le défaut que l'ADR 0053 a corrigé côté acheteuse, subsistant ici. | 2×2×3=**12** |
| **C-07** | 4-machines | silence | Une réponse de Flow livraison arrivée hors de l'état `ville` est perdue sans un mot (default → accueil). | 2×2×3=**12** |

### 4.3 Requalifiés en décisions actées (résidus dicibles)

- **B1** (sauvegarde non planifiée) → **décision** : ADR 0023 §hors-session +
  runbook avec la ligne cron prête. *Résidus* : `checklist-lancement.md` n'a
  pas d'item « cron de sauvegarde posé », et « durée réellement constatée »
  du runbook est vide.
- **B6** (vérification post-déploiement sautée) → **décision documentée**
  (workflow + runbook). *Résidu* : rien n'exige `SHOP_BASE_URL` en
  production — le pas resterait vert à perpétuité.
- **A3** (contraintes hors migrations) → **réfuté** : tous les chemins réels
  enchaînent `apply-constraints` (ADR 0014, fly release_command, CI,
  restauration qui re-vérifie). *Résidu* : aucune sonde runtime ne vérifie en
  production que les triggers existent.
- **D8** (« menu » sous arbitrage) → **décidé mot pour mot par l'ADR 0052**
  (postérieur et plus spécifique que 0051). *Résidus* : la copie de
  l'arbitrage n'annonce pas « annuler » ; le spread `...enPause` manquant à
  la reconstruction du comptoir est une fragilité de code mort.
- **B7** (budget de poids) → **réfuté** : le « dépassement » lu dans la
  sortie de test était la *fixture* du test qui prouve que la porte casse ;
  le budget réel est à 23/120 Ko et fait exit 1 deux fois en CI.

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

Un lot par session, dans l'ordre décroissant de sévérité, chacun avec son
test de non-retour. Les correctifs de la section 4.1 sont livrés avec ce
rapport (ADR 0089 pour l'argent). Restent :

1. **Lot « la commande expire pour de vrai » (A2, sév. 64).** Il exige une
   décision de modèle AVANT le code — aucun état « expiree » n'existe :
   annulation datée avec cause ? état propre ? C'est un ADR (§7.7 : l'état
   cible ne s'invente pas), puis le job pg-boss qui applique
   `domain/order/expiration.ts` déjà écrit et testé. En attendant, la copie
   de la relance ne doit PAS être affaiblie : c'est le lot qui doit rattraper
   la promesse, pas la promesse qu'on abaisse.
2. **Lot « les statuts Meta entrants » (B4, 45).** Cueillir `value.statuses`,
   journaliser les `failed` avec leur code, un compteur — et l'ADR qui dit ce
   qu'on en fait (rien de plus en v1 : voir, pas réagir).
3. **Lot « la couche média se voit » (D4, 30 + D3, 18).** Compteurs
   `catalog.bot.media.*` sur lire/lireCdn/déchiffrement/ré-encodage, et la
   cause du refus dite dans le fil avec les messages qui existent déjà.
4. **Lot « la réponse ne se perd plus » (B5, 24).** Décision d'abord (ADR) :
   retry borné sur 5xx transitoire, ou ne pas `termineLe` sur échec d'envoi
   pur — en respectant le compromis de l'ADR 0040.
5. **Lot « l'acompte dû se fige » (A4, 20).** Migration expand : persister le
   montant demandé à la création ; le contrôle n° 2 compare à ce qui a été
   demandé, pas à ce qu'une constante vaut aujourd'hui.
6. **Lot « les mots du mode d'emploi ne sont pas des noms » (C-01, 18 +
   C-04, C-07, 12).** Filtrer `demandeComptoir`/`demandeAjoutArticle` dans
   `article_nom` (re-poser la question), « corriger » du comptoir qui garde
   les faits, la réponse de Flow tardive qui se dit.
7. **Résidus des décisions (4.3)** — trois lignes de checklist et une sonde :
   item « cron de sauvegarde posé », `SHOP_BASE_URL` exigée en production,
   sonde runtime des triggers sur `/api/statut`, copie de l'arbitrage.

Après quoi la séquence `PROMPTS-premium.md` (P1-P7) reprend, comme son P0
l'ordonne : les constats confirmés d'abord, les nouveautés ensuite.

> **État au 15/08/2026 — les sept lots sont livrés**, chacun avec ses tests
> de non-retour : lot 1 → ADR 0090 (expiration), lot 2 → ADR 0091 (statuts
> Meta), lot 3 → ADR 0092 (chaîne média), lot 4 → ADR 0093 (réessai borné),
> lot 5 → ADR 0094 (acompte figé), lot 6 → C-01/C-04/C-07 corrigés dans les
> machines (les tests-pièges du harnais sont devenus des non-retours), lot 7
> → résidus §4.3 (items 4.15-4.16 de la checklist, `SHOP_BASE_URL` exigée en
> production, sonde `garantiesSql` sur `/api/statut`, copie d'arbitrage qui
> annonce « annuler »). La voie est libre pour P1-P7.

## 7. Annexes

- Harnais : `apps/api/src/domain/bot/__tests__/harnais.ts` (+ `-parcours`,
  `-matrice`), instantanés sous `__instantanes__/`.
- Les cartes de couches (phase 1) et les verdicts adverses (phase 4) sont
  résumés dans les constats ; leurs `zonesNonLues` déclarées ont borné ce que
  ce rapport affirme.
- « Je n'ai pas mesuré » reste un résultat : les capacités Meta non mesurées
  (§8 du protocole) n'ont fait l'objet d'aucune affirmation nouvelle ici.
