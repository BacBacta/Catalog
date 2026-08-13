# Audit du parcours — 13/08/2026

Exécution du prompt `docs/terrain/audit-parcours-prompt.md`.

**Verdicts** : `guidé` (l'étape suivante est visible), `devinable` (il faut
connaître un mot), `muet` (rien ne répond, ou l'échec ne se dit pas), `faux`
(le système affirme quelque chose d'inexact).

**Couverture de cette passe** — dit d'entrée, parce que le prompt l'exige :

| Dimension | État |
|---|---|
| Le **silence** (échecs non dits), tous adaptateurs | **couvert, exhaustif** |
| Vendeuse : ouverture, article, photo, carte | **couvert, code cité** |
| Acheteuse : arrivée, catalogue, slug inconnu | **couvert partiellement** |
| Acheteuse : panier → livraison → rampe → preuve → avis | **NON couvert** — passe suivante |
| Vendeuse : preuve, étapes de commande, solde, congés | **NON couvert** — passe suivante |

Ce qui n'est pas couvert n'est pas déclaré `guidé` par défaut. Il est déclaré
**non mesuré**, et c'est différent.

---

## 1. Le motif — le silence, mesuré partout

C'est la maladie dont les trois défauts du banc sont les symptômes. La passe
a été exhaustive sur `apps/api/src/adapters/`.

### 1.1 Les appels sortants sans délai d'attente

| Adaptateur | Avant | Verdict | État |
|---|---|---|---|
| `whatsapp-bot.ts` | `fetchBorne` | — | déjà borné (ADR 0085) |
| `whatsapp-media.ts` | `fetchBorne` | — | déjà borné (ADR 0085) |
| `reconstruction-boutique.ts` | `fetchBorne` ×2 | — | déjà borné (ADR 0085) |
| **`sms-mboa.ts`** | `fetch` **nu** | **muet** | **corrigé** |
| **`sms-orange.ts`** | `fetch` **nu** | **muet** | **corrigé** |
| **`sms-whatsapp.ts`** | `fetch` **nu** | **muet** | **corrigé** |
| **`storage-s3.ts`** | SDK **sans délai** | **muet** | **corrigé** |

Les trois canaux SMS sont **la porte d'entrée du produit** : une vendeuse qui
ne reçoit pas son code de connexion ne peut rien faire d'autre. L'ADR 0085
avait borné les appels du *bot* et laissé ceux de l'*authentification*.

`storage-s3.ts` est le plus grave, et c'est **le défaut 3 du banc**. Le SDK
AWS v3 n'impose aucun délai par défaut (`requestTimeout` vaut zéro,
c'est-à-dire l'infini). La carte-vitrine fait **trois `put` d'affilée**. Un
stockage qui accepte la connexion puis se tait suspendait la réponse entière.

### 1.2 La décoration composée avant le premier envoi

`apps/api/src/bot.ts`, effet `envoyer_carte` : `carteVitrine(deps, sellerIdent)`
était appelé **sans `.catch()`**, et tout ce qui précédait n'était envoyé
qu'après. Verdict **muet**. La leçon de l'ADR 0085 — « l'essentiel part
d'abord » — avait été appliquée à la publication d'article et **pas** à la
carte.

**Corrigé** : filet autour de l'appel, et un message qui DIT l'échec au lieu
de laisser un bouton sans effet.

### 1.3 Les portes qui rendent `null` sans rien dire

Chaîne de la photo, du formulaire jusqu'à la base :

| Étage | Portes silencieuses | Fichier |
|---|---|---|
| Téléchargement CDN | 7 × `return null` | `whatsapp-media.ts:87` |
| Déchiffrement | **8** × `return null` | `media-cdn.ts:47` |
| Lecture `media_id` | 8 × `return null` | `whatsapp-media.ts:107` |
| Ré-encodage | `resultat.ok` faux → ignoré | `bot.ts` |

Aucune ne journalise. Verdict **muet ET faux** : le bot répondait « Sans photo
pour l'instant », la même phrase qu'à une vendeuse qui n'avait rien envoyé.
**C'est le défaut 1 du banc.**

**Corrigé** : `creerArticleDepuisFil` rend désormais `photoPerdue`, et
`messageArticlePublie` a **trois** états au lieu de deux. L'échec se dit, et
il donne le geste suivant.

> On ne peut pas garantir que cette chaîne n'échouera jamais — elle traverse
> un CDN, un déchiffrement authentifié et un ré-encodage. On peut garantir
> qu'elle le **dira**. C'est la seule promesse tenable, et elle suffit.

---

## 2. Vendeuse — le parcours vérifié

| Étape | Geste | Aujourd'hui | Verdict |
|---|---|---|---|
| Découverte | ouvre le fil, n'écrit rien | amorces posées le 13/08, **invisibles au banc** | **muet** — non résolu, voir §4 |
| Ouverture | remplit le Flow 2 écrans | une bulle + menu natif | `guidé` (ADR 0088) |
| Ouverture | tape « je veux vendre » | machine question par question | `guidé` |
| Premier article | Flow avec photo | photo perdue **sans le dire** | **muet** → corrigé |
| Premier article | photo légendée « nom prix » | reconnu | `guidé` |
| Article suivant | bouton « Ajouter un article » | Flow rouvert | `guidé` |
| Carte | ligne « Ma carte à poster » | carte ou pack statut | `guidé`, mais **muet** si le stockage pend → corrigé |
| Reversement | aucun geste | vit dans « ma boutique » + relance 20 h | `devinable` |

### Le défaut d'accueil (défaut 2) — non résolu, et c'est dit

Les amorces et commandes **sont posées** — vérifié par
`depots-meta → accueil-etat` le 13/08 : quatre amorces, quatre commandes,
posées à 15:54. Elles ne s'affichent pas chez le testeur.

**Trois hypothèses, aucune mesurée** :

1. Meta ne montre les amorces qu'aux conversations **jamais ouvertes** — le
   fil du testeur a un historique.
2. Elles n'apparaissent qu'au-dessus d'un champ de saisie **vide**, sur
   certaines versions du client.
3. La propagation demande plus de temps que l'écart entre la pose et le test.

**Aucune ne doit être supposée.** Le protocole du prompt s'applique : lire la
référence, mesurer, écrire le verdict, puis coder. C'est la première tâche de
la passe suivante.

**Le palliatif ne dépend pas du verdict** : quelle que soit la réponse, une
conversation qui s'ouvre sur rien est un défaut produit. Il faut un premier
message d'accueil côté Catalog, déclenché au premier message entrant d'un
numéro inconnu — il ne coûte rien et ne dépend d'aucune capacité Meta.

---

## 3. Acheteuse — ce qui est vérifié

| Étape | Geste | Aujourd'hui | Verdict |
|---|---|---|---|
| Arrivée | lien `wa.me?text=boutique <slug>` | catalogue ouvert | `guidé` |
| Arrivée | lien de fiche produit | l'article s'ouvre directement | `guidé` (ADR 0066) |
| Arrivée | slug inconnu ou abîmé | `t.boutiqueIntrouvable` | `guidé` |
| Arrivée | change de langue | détection passive + bascule | `guidé` (ADR 0084) |
| Catalogue | forme de message non lue | `t.inconnue` — dit et propose | `guidé` |

Le reste du parcours acheteuse — panier, livraison, rampe, contre-signature,
suivi, avis — **n'a pas été parcouru dans cette passe**. La tâche #73 le porte
déjà.

---

## 4. Ce que la passe suivante doit prendre, dans cet ordre

1. **Mesurer les amorces** puis, quel que soit le verdict, poser un message
   d'accueil au premier contact. C'est le défaut le plus visible : le produit
   s'ouvre sur du vide.
2. **Parcourir le reste du fil acheteuse** avec la même grille — panier,
   livraison, rampe USSD, contre-signature, avis.
3. **Parcourir le reste du fil vendeuse** — collage du SMS, étapes de
   commande, encaissement, congés.
4. **Étendre le filet « l'essentiel part d'abord »** à tous les effets qui
   composent une décoration : `poser_chaine`, `creer_vente`, le pack statut.
   La carte est corrigée ; les autres n'ont pas été vérifiés un par un.

## 5. Ce qui reste volontairement non fait

Inchangé, et rappelé pour que personne ne le rouvre en silence : les variantes
produit, le pidgin (`PIDGIN_RELU` reste `false`), et tout ce qui exige des
gabarits utilitaires WABA.
