# Prompt — audit du pipeline Catalog, de bout en bout

> Version 2, 13/08/2026. La v1 a été exécutée et **a échoué à faire ce qu'on
> lui demandait** ; le §0 dit exactement comment, parce qu'un prompt qui ne
> nomme pas ses propres pièges les reproduit.
>
> À copier tel quel dans une session neuve, sur une machine qui a le dépôt.

---

## §0 — Ce que la v1 a raté, et que tu ne dois pas refaire

La v1 a produit un audit qui **paraissait sérieux** et ne l'était pas. Cinq
défauts, tous à éviter :

1. **Fixation sur un seul motif.** Elle avait trouvé « le silence » et a tout
   ramené à lui. Résultat : quatre appels réseau non bornés trouvés — vrai
   gain — et **rien** sur l'argent, les données, les jobs, l'exploitation.
   Un motif trouvé tôt devient un œillère. **Cherche au moins cinq familles
   de défaut avant d'en privilégier une.**
2. **Périmètre réduit à la conversation.** Le produit n'est pas le fil
   WhatsApp. C'est une chaîne qui va du lien partagé jusqu'à la sauvegarde
   de la base. Le §2 l'énumère.
3. **Lecture de code prise pour vérification.** Lire une fonction dit ce
   qu'elle *prétend* faire. Seule une exécution dit ce qu'elle fait. Le §4
   impose de **construire un harnais** avant de conclure quoi que ce soit.
4. **Couverture déclarée, pas mesurée.** La v1 a écrit « couvert » en tête de
   tableau, sans compter. Le §7 impose un **chiffre calculé par le harnais**.
5. **Aucun travail parallèle.** Une passe séquentielle sur quinze couches
   tient dans aucune session. Le §4 impose le fan-out par agents.

---

## §1 — Ton mandat

Tu travailles sur **Catalog** : commerce WhatsApp pour les vendeuses
camerounaises. La vente se fait dans la conversation ; la valeur numéro un
est la **preuve de paiement opposable**.

Le porteur du produit, le 13/08/2026 :

> « L'idée est de passer vraiment du stade de bot à une réelle application.
> Et l'approche que nous avons est mauvaise. »

Ton mandat n'est pas de corriger des défauts connus. C'est de **produire une
image vérifiable de l'état réel du pipeline**, des deux personas, sur toute
la chaîne — puis de construire ce qui manque.

Le public n'est pas technique. Une vendeuse qui vend déjà sur WhatsApp ; une
acheteuse qui n'a jamais entendu parler du produit. **Aucune des deux ne doit
avoir à deviner.**

### Lectures obligatoires, avant toute écriture

1. `AGENTS.md` — le contrat de travail, il prime sur toute habitude.
2. `CLAUDE.md` — l'état de la séquence et les points volontairement non faits.
3. `docs/adr/` — au minimum `0004`, `0005`, `0006`, `0009`, `0016`–`0023`,
   `0031`–`0039`, `0057`, `0061`, `0065`, `0082`–`0089`.
4. `docs/formats-sms-operateurs.md` — **en entier**, c'est une spécification.
5. `docs/audit-parcours-2026-08.md` — l'audit v1, ses conclusions et ses
   trous déclarés. Tu le remplaces, tu ne le prolonges pas.

Le §7.7 d'`AGENTS.md` interdit la dérive silencieuse. Trois points sont
**vus, décidés, volontairement non faits** : variantes produit, pidgin non
relu (`PIDGIN_RELU = false`), tout ce qui exige des gabarits utilitaires
WABA. Les rouvrir en silence est la faute la plus grave de ce dépôt.

---

## §2 — Le périmètre : quinze couches, de A à Z

Chaque couche est auditée. Aucune n'est « supposée bonne ».

| # | Couche | Ce qu'on y cherche |
|---|---|---|
| 1 | **Acquisition** | lien de statut, QR, chaîne, boutique web, `wa.me`, fiche produit — chaque porte mène-t-elle où elle promet ? |
| 2 | **Transport entrant** | webhook : signature, idempotence, ordre, rejeu, doublons, latence, fenêtre de 24 h |
| 3 | **Aiguillage** | vendeuse vs acheteuse, TTL d'état, reprise après coupure, collisions |
| 4 | **Machines de domaine** | inscription, conversation, comptoir, congés : transitions atteignables, états orphelins, boucles |
| 5 | **Données & migrations** | expand/contract, contraintes SQL, colonnes mortes, invariants tenus par la base et non par le code |
| 6 | **Argent** | entiers XAF, `splitDeposit`, `amount_paid + balance = total`, arrondis, aucun flottant nulle part |
| 7 | **Preuve** | les sept contrôles, unicité réseau-large, sens du message, horodatage, décodeur Orange |
| 8 | **Rampe de paiement** | codes USSD en configuration, drapeau `verifie`, repli si le raccourci échoue |
| 9 | **Médias** | entrée WhatsApp, CDN chiffré, ré-encodage, plafond 100 Ko, stockage, échecs |
| 10 | **Sortie** | ordre des messages, fenêtre, file d'attente, gabarits, ce qui part quand rien ne va |
| 11 | **Web public** | instantané, boutique statique, `/v/?c=`, suivi, en-têtes, budget de poids |
| 12 | **App vendeuse** | session, hors-ligne, quatre états d'écran, accessibilité |
| 13 | **Jobs** | pg-boss : expiration, relances, idempotence, que se passe-t-il si un job échoue |
| 14 | **Observabilité** | traces, rédaction du SMS brut, canari de formats, ce qu'on saurait un jour d'incident |
| 15 | **Exploitation** | CI, secrets, déploiement, sauvegarde, restauration |

### Les deux parcours, comme fil conducteur

**Vendeuse** : découverte → ouverture → premier article → photo → carte et
partage → reversement → première commande → collage du SMS → étapes de
commande → encaissement du solde → avis reçu → congés → reprise.

**Acheteuse** : arrivée → catalogue → article → quantité → panier →
livraison → récapitulatif → commande → rampe USSD → paiement →
contre-signature → suivi → réception → avis vérifié.

Les parcours **traversent** les couches ; ils ne les remplacent pas. Un
défaut de la couche 13 ne se voit dans aucun parcours et compte autant.

---

## §3 — Cinq familles de défaut, cherchées séparément

Cherche-les **toutes les cinq** avant de privilégier l'une. C'est la garde
contre le piège n°1 du §0.

| Famille | Question qui la révèle |
|---|---|
| **Silence** | si cette action échoue, la personne le sait-elle ? |
| **Mensonge** | le système affirme-t-il quelque chose qu'il ne sait pas ? |
| **Impasse** | existe-t-il un état d'où l'on ne peut ni avancer ni sortir ? |
| **Devinette** | faut-il connaître un mot non affiché pour continuer ? |
| **Corruption** | un invariant peut-il être violé — argent, unicité, ordre ? |

Verdicts, par case de matrice :

- `guidé` — l'étape suivante est visible sans deviner ;
- `devinable` — il faut connaître un mot ;
- `muet` — rien ne répond, ou l'échec ne se dit pas ;
- `faux` — le système affirme quelque chose d'inexact ;
- `dangereux` — un invariant peut être violé.

`dangereux` prime sur tout. `muet` et `faux` sont bloquants.

---

## §4 — La méthode : cinq phases, avec fan-out

**Tu ne fais pas ce travail seul.** Une passe séquentielle sur quinze couches
ne tient dans aucune session, et une session unique produit des angles morts
corrélés. Utilise l'outil `Agent` (ou `Workflow` si l'utilisateur l'a
autorisé) pour paralléliser.

### Phase 0 — amorçage (toi, seul)

Lis le §1. Dresse l'inventaire des points d'entrée réels : routes HTTP,
effets de bot, jobs, scripts. **Ne conclus rien.** Produis la liste des
couches à cartographier et le découpage des lots d'agents.

### Phase 1 — cartographie parallèle (un agent par couche)

Un agent par couche du §2. Chacun rend un objet structuré :

```json
{
  "couche": "07-preuve",
  "pointsEntree": [{"fichier": "src/routes/…ts", "ligne": 42, "role": "…"}],
  "invariants": [{"enonce": "…", "tenuPar": "base|code|rien",
                  "fichier": "…", "ligne": 0}],
  "cheminsEchec": [{"quoi": "…", "ditALUtilisateur": true,
                    "journalise": false, "fichier": "…", "ligne": 0}],
  "dependances": ["…"],
  "zonesNonLues": ["…"]
}
```

`zonesNonLues` est **obligatoire et non vide sauf preuve** : un agent qui
prétend avoir tout lu ment presque toujours.

### Phase 2 — le harnais (toi, et c'est le cœur)

**Avant toute conclusion, construis un simulateur exécutable.** C'est ce qui
sépare cet audit du précédent.

Ce qui existe déjà :

- `apps/api/scripts/sandbox-entrant.mjs` — pousse un entrant RÉEL vers la
  route ; les réponses partent vraiment sur WhatsApp. Utile en fin de course,
  inutilisable pour l'exhaustivité.
- Les machines de domaine sont **pures** (`AGENTS.md` §4) : `reagirVendeuse`,
  la machine acheteuse, le comptoir. Elles se pilotent sans base ni réseau.

Ce qu'il faut construire — `apps/api/src/domain/bot/__tests__/harnais.ts` ou
équivalent :

1. **Un pilote** qui prend une suite de gestes (`texte`, `bouton`, `liste`,
   `flux`, `image`, `localisation`, `silence`, forme inconnue) et rend la
   suite des messages émis, l'état final, et les effets demandés.
2. **Un enregistreur** qui écrit chaque scénario en instantané lisible —
   pour qu'une régression de copie se voie dans un diff, pas dans une
   relecture.
3. **Un compteur de couverture** : quelles cases (étape × geste) ont été
   réellement exercées. C'est ce chiffre qui compte, pas une déclaration.

Le harnais doit être **déterministe** : le temps et l'aléa arrivent en
paramètre (règle déjà tenue par `src/domain`, et un test la garde).

### Phase 3 — simulation exhaustive (fan-out par scénario)

Un agent par groupe de scénarios, chacun **exécutant le harnais**, pas
lisant le code. Pour chaque étape, la liste des gestes à jouer :

texte juste · texte mal orthographié · texte sans accents · anglais ·
pidgin · bouton attendu · bouton d'un message ancien · ligne de liste ·
réponse de Flow valide · Flow tronqué · photo · photo légendée · vocal ·
sticker · document · localisation · hors-sujet · **silence** · double envoi ·
retour en arrière · abandon · reprise après 25 h.

Et les intentions, à chaque étape : avancer · corriger · revenir ·
abandonner · comprendre · **vérifier que c'est sérieux** · joindre un humain ·
recommencer à zéro.

Chaque agent rend une liste de constats au format du §5.

### Phase 4 — vérification adverse (fan-out par constat)

**Aucun constat ne survit sans épreuve.** Pour chaque constat, lance
plusieurs agents indépendants chargés de le **réfuter** — pas de le
confirmer. Donne-leur des angles distincts :

- *reproduction* : le scénario rejoue-t-il vraiment ? sinon, réfuté ;
- *lecture de code* : le code fait-il déjà ce que le constat dit manquant ?
- *intention produit* : est-ce un défaut, ou une décision déjà prise dans un
  ADR ? (le cas le plus fréquent et le plus coûteux)

Un constat qui survit à la majorité est `CONFIRMÉ`. Sinon `PLAUSIBLE`, et il
descend en priorité. **Un constat réfuté disparaît du rapport** — le garder
« pour information » pollue la suite.

### Phase 5 — synthèse, priorisation, implémentation

Classe par sévérité (§6). Implémente par lots, `dangereux` d'abord. Chaque
lot : le code, les tests de non-retour, la chaîne verte, un commit.

---

## §5 — Le standard de preuve

Un constat sans ces champs n'existe pas :

```json
{
  "id": "C-014",
  "couche": "09-medias",
  "persona": "vendeuse",
  "etape": "premier article",
  "famille": "silence",
  "verdict": "muet",
  "reproduction": ["flux:article{nom:'Pagne',prix:1000,photo:<cdn>}"],
  "observe": "message « Sans photo pour l'instant »",
  "attendu": "l'échec de lecture est dit, et le geste suivant donné",
  "preuve": {"fichier": "src/adapters/media-cdn.ts", "ligne": 47,
             "extrait": "8 × return null, aucun journalisé"},
  "impact": "…", "frequence": "…", "detectabilite": "…",
  "severite": 0,
  "remede": "…",
  "testQuiEchoueraitAujourdhui": "…",
  "adverse": {"tentatives": 3, "refutations": 0, "statut": "CONFIRME"}
}
```

`testQuiEchouerait Aujourdhui` est le champ le plus important : un constat
qu'on ne sait pas transformer en test est une opinion.

---

## §6 — La sévérité, calculée et non ressentie

**sévérité = impact × fréquence × détectabilité**, chaque facteur de 1 à 5.

- **impact** — 5 : de l'argent ou une preuve est perdu ou faussé ; 4 : la
  personne est bloquée sans issue ; 3 : elle doit deviner ; 2 : friction ;
  1 : cosmétique.
- **fréquence** — 5 : à chaque parcours ; 1 : cas rare.
- **détectabilité** — **inversée** : 5 : rien ne le signale, ni à la
  personne ni dans une trace ; 1 : ça crie.

La détectabilité inversée est délibérée : un défaut rare mais **invisible**
coûte plus cher qu'un défaut fréquent et bruyant, parce qu'il vit des mois.

Traite dans l'ordre décroissant. À sévérité égale, le parcours acheteuse
prime — elle n'a aucune raison de persévérer.

---

## §7 — La couverture se mesure

Le rapport porte un tableau **calculé par le harnais** :

| Couche | Cases possibles | Cases exercées | % | Non exercées |
|---|---|---|---|---|

Une case non exercée est marquée **`non mesuré`**, jamais `guidé`. Écrire
« couvert » sans le chiffre est le défaut n°4 du §0.

**Seuil** : aucune couche du parcours principal sous **80 %**. En dessous,
dis-le en tête de rapport plutôt que d'arrondir.

---

## §8 — Les capacités Meta : mesurer, jamais supposer

Déjà mesuré, réutilisable sans re-mesure :

- **Flows** multi-écrans sans point d'entrée serveur (`navigate` +
  `complete`) — cinq publiés et branchés ;
- **Liste** : 10 lignes, titre 24, description 72, en-tête 60, pied 60 ;
- **Boutons de réponse** : 3 au maximum ;
- **`cta_url` : ACCEPTÉ** (ADR 0087). Règle : « va voir cette page », jamais
  « prends ceci et colle-le ailleurs » — un lien à copier reste du texte ;
- **Amorces et commandes** posées — mais **non observées** chez le testeur :
  c'est un constat ouvert, pas une capacité acquise.

Tout le reste **se mesure** :

1. lire la référence officielle ;
2. si elle est muette ou ambiguë — **c'est déjà arrivé, ADR 0087** —
   construire un script dans `apps/api/scripts/`, exécuté par le workflow
   `depots-meta`, qui rend le verdict de l'API ;
3. écrire le verdict dans un ADR, **accepté ou refusé** ;
4. seulement alors, écrire du code qui en dépend.

**Indisponible** : tout ce qui exige des gabarits utilitaires attend le WABA.
Si un problème n'a pas d'autre solution, **dis-le** au lieu de contourner.

---

## §9 — Livrables

1. `docs/audit-pipeline-2026-08.md` — le rapport : couverture mesurée,
   constats au format §5, sévérités calculées, plan de lots.
2. Le **harnais**, versionné et exécutable par `pnpm test`.
3. Les **instantanés** de scénarios, lisibles en diff.
4. Un **ADR** par décision de direction, à la suite de `0089`.
5. Le **code**, par lots, `dangereux` → `muet`/`faux` → `devinable`.
6. Un **test de non-retour** par constat corrigé.

---

## §10 — Définition de terminé

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size
```

Les cinq passent, plus `pnpm test:coverage` (90 % sur `src/domain`).

Et **trois preuves** que la v1 n'avait pas :

- le harnais tourne en CI et rend son tableau de couverture ;
- chaque constat `CONFIRMÉ` a survécu à sa vérification adverse ;
- chaque case `guidé` est justifiée par un **scénario exécuté**, pas par une
  lecture.

---

## §11 — Contraintes non négociables

- Montants en **entiers XAF**, jamais de flottant, `splitDeposit` intouchable.
- **Aucun champ `address`** — `{ mode, city, quartier, landmark, phone, geo? }`.
- **Catalog n'encaisse jamais**, aucun calcul de commission.
- **Une capture d'écran n'est jamais une preuve.**
- Le **SMS d'émission seul** ne fait jamais « prouvé ».
- **Aucun code USSD en dur.**
- Le **code secret** mobile money : jamais demandé, affiché ni stocké.
- **Boutique publique ≤ 30 Ko de JS**, aucune police téléchargée.
- **WCAG 2.2 AA**, cibles ≥ 44 px, collage jamais bloqué.
- Aucun secret dans le dépôt — test et commentaire compris.
- Les motifs SMS **ne s'inventent pas** : `docs/formats-sms-operateurs.md`.

## §12 — Hors périmètre

- `apps/site` (Horizon Services) — **ne pas y toucher**.
- Le réveil de l'adaptateur agrégateur.
- Le pidgin servi (`PIDGIN_RELU` reste `false`).
- Toute construction dépendant d'un gabarit utilitaire non approuvé.

---

## §13 — Les règles qui priment sur ta vitesse

> **Signaler plutôt que combler.** Face à une ambiguïté — format non
> confirmé, capacité non mesurée, règle floue —, arrête-toi et demande. Un
> format reconstitué se marque « à confirmer » **dans le code et dans
> l'interface**.

> **Un lot par fois.** `AGENTS.md` §7.1. Un agent qui reçoit trois lots en
> livre trois moitiés — et l'audit v1 en est la preuve.

> **Ne déclare jamais une couche saine sans l'avoir exercée.** « Je n'ai pas
> mesuré » est un résultat acceptable et utile. « C'est bon » sans preuve ne
> l'est pas : c'est la seule erreur de ce protocole qu'on ne rattrape pas,
> parce qu'elle ferme la question.
