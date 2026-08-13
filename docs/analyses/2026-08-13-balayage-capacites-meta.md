# Balayage des capacités Meta — ce qui peut automatiser Catalog

Date : 13/08/2026
Portée : plateforme WhatsApp Business — messages interactifs, Flows, gabarits,
commerce, appels.

---

## Comment lire ce document

Trois niveaux, jamais mélangés. C'est la règle du §8 du protocole d'audit et de
l'AGENTS.md §7.7 : **on mesure, on ne suppose pas.**

| Niveau | Ce que ça veut dire |
|---|---|
| **MESURÉ** | Ce dépôt l'a fait passer par son propre WABA et a lu le verdict. Un ADR le porte. |
| **DOCUMENTÉ** | La référence Meta le dit, à la date indiquée. **Ce n'est pas une garantie** — voir ci-dessous. |
| **NON MESURÉ** | Ni l'un ni l'autre. Aucune ligne de code ne doit en dépendre. |

---

## Le résultat qui gouverne tout le reste

**La référence Meta est incomplète, et elle se contredit d'une page à l'autre.**
Ce n'est pas une opinion, c'est vérifié aujourd'hui.

La référence des messages
([`cloud-api/reference/messages`](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/),
consultée le 13/08/2026) énumère exactement sept types interactifs :

```
button · call_permission_request · catalog_message · list · product · product_list · flow
```

**Deux types que Catalog envoie en production n'y figurent pas** :

- `cta_url` — le bouton-lien. Absent de la référence, présent dans les guides.
  L'ADR 0087 a tranché la contradiction **par la mesure** : accepté.
- `location_request_message` — la demande de position. Absent de la référence,
  employé par `messages.ts` et joué par le harnais à chaque parcours livraison.

La même fragmentation touche les Flows : trois pages de référence différentes
rendent trois listes de composants différentes, et aucune ne mentionne
`PhotoPicker` — que ce dépôt a pourtant **mesuré comme accepté** le 12/08
(brouillon jetable `1713578936575692`, aucune `validation_error`, supprimé).

**Conséquence pratique** : la question n'est jamais « la doc dit-elle que c'est
possible ? » mais « qu'est-ce que NOTRE WABA en dit ? ». Le dépôt a déjà l'outil
pour répondre — le workflow `depots-meta`, en mode `--etat`, lecture seule.

---

## 1. Ce que Catalog emploie déjà — MESURÉ

| Capacité | Où | Limites mesurées |
|---|---|---|
| Message **texte** | partout | 4 096 car. |
| **Boutons de réponse** | tout le tunnel | **3 maximum**, titre 20 car., corps 1 024 |
| **Liste** | catalogue, quantités, menu vendeuse (ADR 0088) | **10 lignes**, titre 24, description 72, en-tête 60, pied 60 |
| **Image** + légende | fiche article, carte-vitrine, pack statut | légende 1 024 car. |
| **Réaction** | accusé sur la photo, ✅ sur le SMS collé | — |
| **Accusé de lecture + frappe** | avant tout traitement (ADR 0049) | de confort |
| **`cta_url`** | ADR 0087 | accepté ; règle : « va voir cette page », jamais « copie ceci » |
| **Demande de position** | étape livraison | s'ajoute à la question, ne la remplace pas (ADR 0005) |
| **Flows** `navigate` + `complete` | 5 formulaires publiés | **sans point de terminaison serveur** |
| **Gabarits utilitaires** | 6 déclarés | hors fenêtre de 24 h |

### Le fil est déjà sobre — chiffre mesuré, pas ressenti

Le harnais d'audit (ADR 0089) compte les bulles émises par geste :

| Parcours | Gestes | Bulles | Ratio |
|---|---|---|---|
| commande complète | 9 | 12 | 1,33 |
| ouverture de boutique | 9 | 10 | 1,11 |
| abandon du tunnel | 4 | 5 | 1,25 |
| congés, reprise 25 h, ville douteuse | 6-7 | 6-7 | **1,00** |
| photo légendée | 2 | 4 | 2,00 |

**Un geste, une bulle**, à deux exceptions près. Le travail des ADR 0086 et 0088
a porté. « Épurer » ne consiste donc plus à retirer des messages — cette marge
est prise — mais à **retirer des gestes**. C'est ce que la suite classe.

---

## 2. Ce qui est CONSTRUIT et pas branché — le gain le plus immédiat

C'est la trouvaille la plus rentable du balayage : **cinq Flows sont publiés
chez Meta, et rien ne garantit qu'ils soient câblés.**

`server.ts` lit cinq variables (lignes 142-160). `.env.example` n'en documente
que **quatre** :

| Variable | Flow | Dans `.env.example` ? |
|---|---|---|
| `WABOT_FLUX_LIVRAISON_ID` | `catalog_livraison` | ✅ ligne 332 |
| `WABOT_FLUX_INSCRIPTION_ID` | `catalog_inscription` | ✅ ligne 348 |
| `WABOT_FLUX_ARTICLE_ID` | `catalog_article` | ✅ ligne 355 |
| `WABOT_FLUX_AVIS_ID` | `catalog_avis` | ✅ ligne 422 |
| **`WABOT_FLUX_OUVERTURE_ID`** | **`catalog_ouverture`** | ❌ **absente** |

Or `catalog_ouverture` est le plus important des cinq : c'est lui qui fait tenir
l'ouverture d'une boutique en **un seul formulaire** au lieu de quatre questions
(ADR 0087, révisé 0088). Quelqu'un qui provisionne la machine depuis
`.env.example` ne le branche pas, et **rien ne le lui dit** — le fil retombe
silencieusement sur les questions, ce qui est le repli voulu mais pas le
comportement voulu.

Toutes les captures du harnais confirment le symptôme : sur huit scénarios,
**aucun message de type `formulaire` n'apparaît**. Les scénarios tournent à la
configuration par défaut, qui est celle de `.env.example`.

**Coût de la correction : une ligne de documentation, et une vérification de
l'état réel de la machine.** Gain : le parcours d'ouverture passe de quatre
tours à un, pour toutes les vendeuses dont le WhatsApp est récent.

**À faire d'abord, avant toute nouvelle capacité.**

---

## 3. Ce qui est DOCUMENTÉ et pourrait servir

Classé par gain pour Catalog, avec son coût réel — le coût est ce que les
articles de blog omettent toujours.

### 3.1 Composants de Flow non employés — le meilleur rapport

Les Flows de Catalog n'utilisent aujourd'hui que des champs de saisie. Ces
composants sont **documentés** (versions Flow JSON indiquées) et ouvriraient des
gestes entiers :

| Composant | Version min. | Ce qu'il automatiserait chez Catalog |
|---|---|---|
| `PhotoPicker` | **MESURÉ accepté** (12/08) | déjà dans `catalog_article` |
| `DocumentPicker` | documenté | — peu d'usage ici |
| `RichText` | 5.1 | un récapitulatif de commande lisible **dans** le formulaire |
| `If` / `Switch` | 4.0 | livraison **ou** retrait dans UN formulaire au lieu de deux écrans |
| `CalendarPicker` | 6.1 | date de remise convenue — mais `data_exchange` **seulement** (voir piège) |
| `ImageCarousel` | non documenté sur les pages atteintes | feuilleter les articles **dans** un formulaire |
| `ChipsSelector` | non documenté sur les pages atteintes | quantité, taille, couleur en un tap |
| `NavigationList` | non documenté sur les pages atteintes | un catalogue navigable sans quitter le formulaire |

**Le piège à connaître** : `CalendarPicker` est donné comme
`data_exchange` **uniquement**. Or Catalog n'a **aucun** point de terminaison de
Flow, et c'est un choix (ADR 0087 : « seul `data_exchange` exigerait un serveur
— on ne l'emploie pas »). Tout composant qui l'exige est **hors d'atteinte sans
un nouvel ADR** qui rouvre cette décision, avec ce qu'elle implique : un
endpoint public, chiffré, signé, disponible — et une panne de plus qui casse un
formulaire.

Les trois composants « non documentés sur les pages atteintes » sont exactement
le cas de `PhotoPicker` avant sa mesure. Ils se **mesurent**, ils ne se
supposent pas.

### 3.2 Carrousels — attention au coût

Documenté : **jusqu'à 10 cartes**, image ou vidéo, corps facultatif depuis 2026,
et **deux boutons par carte**. Feuilleter un catalogue de 10 articles avec un
bouton « Commander » sur chacun serait, en apparence, le geste rêvé.

**Mais c'est un gabarit de la catégorie *marketing*.** Trois conséquences que
la fiche produit ne dit pas :

1. il est **payant** à chaque envoi, là où la Liste actuelle est gratuite dans
   la fenêtre de service ;
2. il exige un **consentement marketing** de l'acheteuse ;
3. il passe par l'**approbation** de Meta, et une série de refus abîme la note
   de qualité du numéro — le workflow `depots-meta` le rappelle déjà.

Pour un catalogue consulté **dans** une conversation ouverte, la Liste (10
lignes, gratuite) reste le bon outil. Le carrousel aurait du sens ailleurs :
une relance de panier abandonné, une nouveauté annoncée à d'anciennes clientes.
Ce n'est pas le même produit, et ça se décide, pas ça s'ajoute.

### 3.3 `catalog_message` / `product_list` — le catalogue natif

Documenté et listé dans la référence des messages. Il exige un **catalogue
Meta Commerce** synchronisé.

C'est déjà **reporté explicitement** (CLAUDE.md : « catalogue natif » attend le
WABA). Le balayage ne rouvre pas la décision ; il note seulement que la capacité
existe et que la contrainte est le catalogue Commerce, pas l'API.

### 3.4 Appels — `call_permission_request`

Le type figure dans la référence des messages. La page d'aperçu n'a rien rendu
d'exploitable aujourd'hui : **NON MESURÉ**, et je ne dirai pas si c'est
disponible au Cameroun ni ce que ça coûte.

L'intérêt pour Catalog est réel mais indirect : la vendeuse et l'acheteuse se
parlent déjà, et un bouton d'appel remplacerait un `wa.me`. À mesurer si le
besoin remonte du terrain, pas avant.

---

## 4. Un piège tarifaire — vérifié, et écarté

Plusieurs publications de 2026 affirment qu'à partir du **1er octobre 2026**,
les messages de service cesseraient d'être gratuits et seraient facturés au
message. Si c'était vrai, ce serait **structurant pour Catalog** : le modèle est
un abonnement de 2 500 F sans commission, et le bot émet une bulle par geste.

**La source primaire dit le contraire.** La page officielle de tarification
([`whatsapp/pricing`](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing),
consultée le 13/08/2026) énonce :

> « All non-template messages are free »
> « Utility templates delivered within an open customer service window are free »

et décrit le 1er octobre 2026 comme un changement de **grilles tarifaires** pour
neuf marchés nommés — Bangladesh, Irak, Népal, Sri Lanka, Kazakhstan, Koweït,
Maroc, Oman, Ukraine. **Le Cameroun n'y est pas.**

**Ce que j'en fais** : rien, sinon le consigner. Une contradiction entre des
articles secondaires et la référence officielle se tranche par la référence —
et, si l'enjeu grandit, par la console de facturation du compte, qui est la
seule source qui engage Meta. C'est un point à re-vérifier fin septembre, pas
un chantier.

---

## 5. Ce qui reste bloqué, et le restera

Sans changement de statut du compte :

- **tout gabarit utilitaire nouveau** attend le WABA (AGENTS.md §9) — donc les
  relances au-delà de 24 h, la notification de la vendeuse hors fenêtre, le
  click-to-WhatsApp ;
- **le catalogue natif** attend un catalogue Meta Commerce ;
- **les amorces (« ice breakers ») et les commandes** sont *posées* mais **non
  observées** chez le testeur (§8) : constat ouvert, pas capacité acquise.

Et trois points restent **volontairement non faits**, que ce balayage ne rouvre
pas : `product.variants` sans modèle, le pidgin écrit et non servi
(`PIDGIN_RELU = false`), le stock qui ne se décompte pas.

---

## 6. Plan de mesure, dans l'ordre

Chaque ligne se fait avec l'outil qui existe déjà : `depots-meta`, mode
`--etat`, ou un brouillon jetable comme celui de `PhotoPicker`.

| # | Mesure | Ce qu'elle débloque | Coût |
|---|---|---|---|
| 1 | **État réel des cinq `WABOT_FLUX_*_ID` sur la machine** | l'ouverture en un formulaire, déjà construite | nul |
| 2 | Brouillon jetable : `ImageCarousel` + `ChipsSelector` + `NavigationList` sans endpoint | un catalogue et une quantité **dans** le formulaire | un brouillon supprimé |
| 3 | Brouillon jetable : `If`/`Switch` | livraison/retrait en un écran au lieu de deux | idem |
| 4 | `RichText` dans un écran de récapitulatif | la relecture avant commande, dans le formulaire | idem |
| 5 | Amorces et commandes : les **observer** sur un téléphone réel | l'accueil avant le premier message | un aller-retour terrain |

Les mesures 2 à 4 se font en un seul brouillon si l'on veut, mais **un composant
par écran témoin** : si le témoin est refusé aussi, c'est la définition qui est
cassée, pas le composant. C'est la méthode qu'a suivie la mesure de
`PhotoPicker`, et elle a marché.

**Chaque verdict s'écrit dans un ADR — accepté ou refusé — avant toute ligne de
code qui en dépend.**

---

## Ce que ce balayage ne dit pas

Il ne dit pas quelle capacité rendra Catalog « intuitive ». La mesure du §1
montre que le fil est déjà à une bulle par geste : le levier restant n'est pas
d'envoyer moins, c'est de **demander moins**. Les composants de Flow non
employés vont dans ce sens — un formulaire remplace trois tours de parole — et
c'est pourquoi ils sont en tête du plan.

Il ne dit pas non plus ce que le terrain pense. Aucune des capacités ci-dessus
n'a été montrée à une vendeuse. `docs/terrain/bot-parcours.html` existe pour ça.

---

## Sources

- [Référence des messages — Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/)
- [Tarification de la plateforme](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Composants de Flow — référence](https://developers.facebook.com/docs/whatsapp/flows/reference/components/)
- [Composants de Flow — guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/components)
- [Gabarits carrousel média](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates)
- [Flow JSON — référence](https://developers.facebook.com/docs/whatsapp/flows/reference/flowjson/)
- [Journal des changements](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog) *(HTTP 500 au moment du balayage — non consulté)*
