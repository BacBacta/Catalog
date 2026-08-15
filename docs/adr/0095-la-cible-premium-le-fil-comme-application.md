# ADR 0095 — La cible premium : le fil comme application

Date : 2026-08-15
Statut : accepté
Portée : la séquence `PROMPTS-premium.md` (lots P1 à P7), articulée avec
l'audit de pipeline `docs/audit-pipeline-2026-08.md`.

## 1. La maquette est la spécification d'expérience

`docs/terrain/parcours-premium.html`, validée par le porteur du produit le
15/08/2026, est **la spécification** de la suite. Les deux personas s'y
jouent de bout en bout, la copie des messages y est finale (français, emoji
compris) : **on la livre, on ne la réinvente pas**. Chaque pas y est
étiqueté, et l'étiquette est une frontière de travail :

- **en place** — le dépôt répond déjà ainsi, source citée. Ne se refait pas ;
  un lot qui « améliore » cette copie au passage est en dérive.
- **cible** — le contenu des lots P1 à P7, dans l'ordre.
- **étage 2 · premium** — attend un ADR de pricing du porteur. Aucun lot ne
  s'en approche.

La doctrine que la maquette joue, et que les lots implémentent :

1. **Un service = une carte structurée.** Boutons et listes natifs, jamais un
   interrogatoire quand une carte suffit (ADR 0035, 0088).
2. **Un seul geste actif à la fois.** Chaque carte propose l'action suivante ;
   deux bulles de suite sans geste entre elles sont un défaut (ADR 0086).
3. **Les Flows Meta remplacent tout dialogue de plus de deux champs**
   (ADR 0055) — avec, toujours, un repli complet sans Flow.
4. **La conversation libre est l'exception, et elle se mesure** : sur le
   parcours nominal, la vendeuse tape UN message inautomatisable — le SMS de
   preuve collé — et l'acheteuse ZÉRO. Ce compteur est celui de la maquette ;
   toute régression (un nouveau mot à taper, une question ouverte de plus)
   se justifie par ADR ou ne se fait pas.

## 2. L'ordre du travail : l'audit d'abord

Un parcours premium posé sur un pipeline qui ment n'est pas premium. Les
constats CONFIRMÉS de l'audit en sévérité « dangereux », « muet » ou « faux »
se corrigent **avant** tout lot de nouveauté.

**État au moment où cet ADR est écrit : c'est fait.** Les sept lots du plan
de l'audit sont livrés (ADR 0089 à 0094, plus les correctifs C-01/C-04/C-07
et les résidus §4.3), chacun avec ses tests de non-retour ; le harnais de
l'audit tourne dans `pnpm test`.

Ensuite : **P1 → P7 dans l'ordre de `PROMPTS-premium.md`**, et deux règles
qui tiennent la séquence :

- chaque lot P laisse le harnais de l'audit **vert** et étend sa couverture
  aux cartes qu'il ajoute — un service neuf entre dans la matrice
  étape × geste dès son lot, pas « plus tard » ;
- quand une copie livrée diffère de la maquette, la maquette se met à jour
  **au même commit**, et l'étiquette « cible » d'un pas livré passe à
  « en place » avec sa source — c'est ce qui garde la spécification vivante.

## 3. Les quatre décisions — posées par défaut, réversibles

Chacune est posée ici au nom du porteur du produit, **par défaut** ; chacune
se renverse par un ADR de révision d'une page, sans dette : aucun schéma,
aucune migration, aucun contrat externe n'en dépend.

### a) La checklist d'onboarding : une ligne de liste, jamais un message

La checklist persistante « 3 étapes pour vendre » (photo publiée → numéro de
reversement → première commande) vit comme **une ligne de plus dans la liste
native du message d'ouverture** (ADR 0088), mise à jour à chaque
réaffichage. Jamais un message de plus : l'ouverture vient d'être ramenée à
une bulle, la checklist ne la défait pas. *Réversion : un ADR qui choisit un
autre porteur (carte dédiée, épingle) — la ligne se retire en un commit.*

### b) La carte-vitrine carrée (1080×1080) : REPORTÉE

Le Statut WhatsApp (1080×1920, ADR 0037) est le canal n° 1 de partage, et le
seul mesuré. Le carré — posts de fil, autres réseaux — attend un **besoin
constaté**, pas une intuition. *Réversion : un ADR d'une page qui cite la
demande observée ; `carte-vitrine.ts` est une fonction pure, une seconde
disposition s'ajoute sans toucher la première (ADR 0059).*

### c) La poussée de la carte-vitrine : une par salve, fenêtre ouverte seulement

Après publication, la carte régénérée part d'elle-même (lot P2), bornée à
**au plus UNE poussée par salve de publication**, et **uniquement dans la
fenêtre de service ouverte**. La carte ne réveille jamais un fil fermé :
aucun gabarit utilitaire pour du confort (ADR 0054, 0060) — une vendeuse qui
vient de publier a, par construction, la fenêtre ouverte ; le cas limite qui
la trouve fermée attend le prochain entrant. *Réversion : un ADR qui accorde
un gabarit à la carte, avec son coût Meta chiffré.*

### d) « Préparée » dans le fil : la même transition que l'app, mot pour mot

Le bouton contextuel « Marquer préparée » (lot P4) appelle **la même
transition** que l'app vendeuse — `avancer()` de `domain/order/cycle.ts` —
avec **les mêmes refus**, `solde_ouvert` compris : pas de remise close sans
preuve ou déclaration, dans le fil comme ailleurs (ADR 0061 : un seul
moteur). Aucun nouveau mot-clé tapé n'est requis ni annoncé ; « livrée
CT-… » reste, et reste annoncé. *Réversion : sans objet pour la transition
(l'unicité du moteur n'est pas révisable par ce chemin) ; un ADR peut en
revanche ajouter ou retirer des boutons contextuels.*

## 4. Ce que la cible ne rouvre PAS

Redit ici pour que personne ne le rouvre en silence (AGENTS.md §7.7) :

- **`product.variants` reste une colonne morte** — la vendre exigerait
  d'inventer le modèle (tailles ? couleurs ? stock par variante ?), décision
  produit non prise ;
- **le pidgin reste écrit et non servi** — `PIDGIN_RELU` reste `false` tant
  qu'une locutrice n'a pas relu (ADR 0034) ; les lots P écrivent leur copie
  `wes` comme les autres, sans la servir ;
- **le stock ne se décompte pas** (ADR 0038) — les textes n'annoncent pas de
  rareté que le produit ne mesure pas ;
- **les étages 2 et 3** — catalogue natif Meta, messages multi-produits,
  numéro dédié par vendeuse — sont des décisions de gamme : elles attendent
  l'ADR de pricing du porteur, et l'étage 1 en production d'abord ;
- **la lecture automatique des SMS** est close (AGENTS.md §9) : le collage
  manuel est le seul chemin ouvert ;
- **`apps/site` est intouché** par toute la séquence.

## 5. Définition de terminé de la séquence

Chaque lot P : la chaîne commune (`pnpm typecheck && pnpm lint && pnpm test
&& pnpm build && pnpm size`), `pnpm test:coverage` à 90 % sur `src/domain`,
le harnais de l'audit vert et étendu, la maquette rejouée et mise à jour au
même commit, et la démonstration propre au lot citée dans son message de
commit.
