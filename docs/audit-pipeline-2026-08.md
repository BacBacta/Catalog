# Audit du pipeline Catalog — 13/08/2026

Exécution du prompt v2 (`docs/terrain/audit-parcours-prompt.md`).
Remplace `docs/audit-parcours-2026-08.md` (audit v1), qui reste au dépôt
comme pièce du dossier — il documente ce qu'une passe par lecture manque.

**Statut : passe 1 sur N.** Phases 0 et 2 faites, phase 1 en cours, phases 3
à 5 à venir. Ce document est écrit au fil de l'eau et dit toujours où il en
est — la v1 avait affirmé une couverture qu'elle n'avait pas mesurée.

---

## §A — Ce qui distingue cette passe de la précédente

| | v1 | v2 (ici) |
|---|---|---|
| Méthode | lecture de code | **exécution** des machines |
| Couverture | déclarée en prose | **calculée**, seuil tenu par un test |
| Familles cherchées | une (le silence) | **cinq**, séparément |
| Périmètre | la conversation | **quinze couches** |
| Parallélisme | aucun | fan-out d'agents |
| Constats | non éprouvés | **vérification adverse** |

---

## §B — Phase 0, l'inventaire (fait)

Points d'entrée réels du produit :

- **16 routes HTTP** — `accuse-livraison`, `auth`, `commandes`, `dev-otp`,
  `health`, `instantane`, `media`, `payout`, `preuve`, `products`, `rampe`,
  `recu`, `seller`, `stats`, `statut`, `whatsapp-entrant` ;
- **1 job** pg-boss — `relance-acompte` ;
- **11 domaines purs** — `bot`, `deploiement`, `order`, `proof`, `ramp`,
  `receipt`, `review`, `securite`, `sms`, `stats` ;
- **21 adaptateurs**, dont un en dormance assumée (`campay.ts`, ADR 0009).

Aucune conclusion tirée à ce stade — c'est la consigne du §4 phase 0.

---

## §C — Phase 2, le harnais (fait)

`apps/api/src/domain/bot/__tests__/harnais.ts`, exercé par
`parcours-mesure.test.ts`. Il tourne dans `pnpm test`, donc en CI.

Trois pièces : un **pilote** (quinze genres de geste, dont le silence), un
**rendu** normalisé pour que les régressions de copie se voient en diff, un
**compteur** dont le dénominateur est fixé d'avance.

### Couverture mesurée à cette passe

| Étape | Cases possibles | Exercées | % |
|---|---|---|---|
| acheteuse/accueil | 15 | 15 | 100 % |
| acheteuse/catalogue | 15 | 15 | 100 % |
| vendeuse/installée | 15 | 15 | 100 % |
| vendeuse/inscription-nom | 15 | 15 | 100 % |
| vendeuse/article-nom | 15 | 15 | 100 % |

**Les autres étapes ne figurent pas au tableau.** Elles ne sont donc pas
« bonnes » : elles sont **non mesurées**. Panier, livraison, rampe,
contre-signature, suivi, avis, congés, encaissement — aucune n'a été exercée.

Le seuil de 80 % est tenu par un test : sous ce seuil, la suite échoue et le
rapport ne peut pas mentir.

---

## §D — Ce que l'EXÉCUTION a rendu, et que la lecture avait manqué

### C-001 · La machine d'inscription ignore deux genres d'entrée

| | |
|---|---|
| Couche | 03 — aiguillage |
| Famille | devinette (conséquence possible : impasse) |
| Verdict | **à vérifier au niveau service** |

Le type `Entree` de `inscription.ts` ne connaît ni `localisation` ni `flux`.
**Le compilateur l'a dit en refusant le harnais** — c'est un fait de type,
pas une opinion. Ces gestes sont interceptés dans `bot.ts` et n'atteignent
jamais la machine.

Conséquence à mesurer : une vendeuse qui envoie un point GPS pendant son
inscription, ou une réponse de Flow dans un état qui ne l'attend pas, suit un
chemin de service que le harnais ne voit pas.

Le harnais **ne masque pas** ce trou : la transcription le marque
`geste traité hors machine — voir bot.ts`.

### C-002 · Le geste central du produit ne produit aucun message

| | |
|---|---|
| Couche | 07 — preuve |
| Famille | silence (différé) |
| Verdict | **délégué**, réponse confirmée au service |

Coller un SMS de paiement rend **zéro message** de la machine et un effet
`verifier_sms`. Sans `messageId` sur le message entrant — et il est
facultatif dans le type — il n'y a même pas d'accusé de lecture.

La première version du détecteur comptait ce cas comme « répond ». C'était
faux **dans le sens le plus dangereux : rassurant**. Le harnais distingue
désormais trois natures — `répond`, `différé`, `muet` — et un test tient la
distinction.

Vérifié au service : `bot.ts` répond dans les trois branches du cas reconnu.
Le constat reste **enregistré** parce qu'il décrit une dépendance fragile,
pas parce qu'il est cassé aujourd'hui.

### C-003 · Un point GPS à l'accueil rend le message d'accueil

| | |
|---|---|
| Couche | 04 — machines |
| Famille | mensonge (léger) |
| Verdict | `devinable` |

Mesuré : à l'accueil acheteuse, `localisation` et une réponse de Flow non
reconnue produisent **le message d'accueil**, comme si elle avait écrit
« bonjour ». Elle a peut-être cru donner son lieu de livraison.

Le repli n'est pas muet — il est **indistinct**. Sévérité faible, mais c'est
un exemple net de la famille « mensonge » que la v1 ne cherchait pas.

---

## §E — Un constat RÉFUTÉ, gardé pour mémoire

**Candidat** : dans `bot.ts`, l'effet `verifier_sms` re-analyse le texte ; si
la ré-analyse désaccordait avec celle de la machine, rien ne serait poussé et
la vendeuse n'aurait aucune réponse.

**Réfutation** : l'effet transporte `entree.texte` à l'identique
(`conversation.ts:1941`), et le service a calculé `smsReconnu` à partir du
même texte par `analyserSms`, qui est pure. Les deux analyses ne peuvent pas
diverger.

Il figure ici parce que le §4 phase 4 l'exige : **un constat réfuté disparaît
du rapport des défauts**, mais la réfutation elle-même a de la valeur — elle
évite qu'un futur agent le « trouve » à nouveau.

---

## §F — Ce qui reste, dans l'ordre

1. **Phase 1** — cartographie des quinze couches, en cours (fan-out).
2. **Phase 3** — brancher le harnais sur les étapes non mesurées : panier,
   livraison, rampe, contre-signature, suivi, avis, congés, encaissement.
3. **Phase 4** — vérification adverse de chaque constat.
4. **Phase 5** — implémentation par lots, `dangereux` d'abord.

Aucune couche n'est déclarée saine. Celles qui ne sont pas au tableau du §C
sont **non mesurées**, et c'est différent.
