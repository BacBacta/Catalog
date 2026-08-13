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

| Composant | Version min. | Source | Ce qu'il automatiserait chez Catalog |
|---|---|---|---|
| `PhotoPicker` | 4.0 | **MESURÉ accepté** (12/08) + page officielle | déjà dans `catalog_article` |
| `DocumentPicker` | 4.0 | officielle | — peu d'usage ici |
| `RichText` | 5.1 | officielle | un récapitulatif de commande lisible **dans** le formulaire |
| `If` / `Switch` | 4.0 | officielle | livraison **ou** retrait dans UN formulaire au lieu de deux écrans |
| `DatePicker` | 1.0 | officielle | **la date de remise, SANS endpoint** — voir la correction ci-dessous |
| `CalendarPicker` | 6.1 | officielle | version riche de la date — `data_exchange` **seulement** (voir piège) |
| `ImageCarousel` | **7.1** | secondaire (2e passe) | feuilleter les articles **dans** un formulaire |
| `ChipsSelector` | **6.3** | secondaire (2e passe) | quantité, taille, couleur en un tap |
| `NavigationList` | **6.2** | secondaire (2e passe) | un catalogue navigable sans quitter le formulaire |

**Le piège à connaître, et sa correction (2e passe)** : `CalendarPicker` est
donné comme `data_exchange` **uniquement** — hors d'atteinte, donc, Catalog
n'ayant aucun point de terminaison de Flow par choix (ADR 0087). La première
passe en concluait que la date de remise était bloquée. C'était faux :
**`DatePicker` (version 1.0) est un champ de formulaire ordinaire**, accepté
dans un `complete` sans endpoint — seule sa variante « on-select-action » exige
l'échange de données. La date de remise convenue est donc atteignable
aujourd'hui, avec le composant le plus ancien de la plateforme.

Les schémas d'`ImageCarousel`, `ChipsSelector` et `NavigationList` viennent de
sources **secondaires** (références de fournisseurs, dérivées de la
spécification Meta) : les pages Meta de ces composants rendaient HTTP 500 le
13/08. C'est exactement le cas de `PhotoPicker` avant sa mesure — ils se
**mesurent**, ils ne se supposent pas. L'instrument existe désormais :
`flux.mjs --mesurer-composants` (voir §6).

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

## 5 bis. Deuxième passe (13/08, soir) — ce que le balayage approfondi ajoute

### La version de Flow JSON est un chantier en soi

La version courante est **7.3** ; les cinq formulaires de Catalog sont en
**7.0**. Trois des composants visés exigent plus que 7.0 — `NavigationList`
6.2+ (déjà couvert), `ChipsSelector` 6.3+ (déjà couvert), mais **`ImageCarousel`
7.1+**. La mesure sonde donc la version **avant** les composants : son premier
brouillon ne porte que le témoin, en 7.3 — s'il est refusé, les verdicts
suivants diraient « version » et non « composant », et il faut le savoir avant
de les lire.

### Les sélecteurs de médias, cette fois sur page officielle

La page `media_upload` — atteignable, elle — confirme et borne ce que la mesure
du 12/08 avait établi : `PhotoPicker` et `DocumentPicker` sont en version 4.0+,
acceptés dans `complete` **et** `data_exchange`, **jamais dans `navigate`** ;
**un seul sélecteur par écran**, jamais les deux ensemble ; 30 fichiers et
25 Mio par fichier au plus, 10 fichiers et 100 Mio par réponse. Les fichiers
arrivent chiffrés (AES256-CBC + HMAC-SHA256), avec leurs métadonnées dans le
`nfm_reply` — la lecture sous deux formes que le dépôt fait déjà (tâche #66).

### Le paiement dans les Flows n'existe pas pour le Cameroun

Les annonces de « paiement sans quitter WhatsApp » sont réelles et **limitées à
deux marchés** : l'Inde (UPI) et Singapour (Stripe). Aucun calendrier
d'extension annoncé. Pour Catalog c'est doublement sans objet : indisponible —
et l'architecture v1 (ADR 0009, dépôt direct, Catalog n'encaisse jamais) ne
changerait pas pour autant. À classer, pas à surveiller.

### Les appels — documenté, non mesuré

L'API d'appels existe des deux côtés : l'acheteuse appelle l'entreprise, ou
l'entreprise appelle après permission. La permission se demande **dans une
conversation ouverte** (une demande par 24 h, deux par 7 jours ; accordée, elle
vaut 72 h ou jusqu'à cinq appels sur 7 jours selon les sources — elles
divergent, et c'est le genre d'écart qui se mesure). Facturation **à la
minute**, cartes d'avril 2026. Les appels sortants sont interdits dans une
liste de pays où le Cameroun **ne figure pas**. Tout ceci vient de sources
secondaires : **NON MESURÉ**, et sans usage identifié chez Catalog — la
vendeuse et l'acheteuse s'appellent déjà, en direct, sans nous.

### Les groupes — nouveau en 2026, et hors doctrine

Une API de groupes existe désormais : jusqu'à 8 membres, 10 000 groupes par
numéro, facturés comme du 1:1. Deux raisons de ne pas y toucher : elle exige un
**compte officiel (OBA)** que Catalog n'a pas, et elle ne porte **aucun message
interactif** — ni boutons, ni listes, ni Flows, c'est-à-dire rien de ce dont le
bot est fait. Un trio vendeuse-acheteuse-livreur est une idée séduisante et un
produit différent. Consigné, refermé.

---

## 6. Plan de mesure, dans l'ordre

Chaque ligne se fait avec l'outil qui existe déjà : `depots-meta`, mode
`--etat`, ou un brouillon jetable comme celui de `PhotoPicker`.

| # | Mesure | Ce qu'elle débloque | État |
|---|---|---|---|
| 1 | **État réel des cinq `WABOT_FLUX_*_ID` sur la machine** | l'ouverture en un formulaire, déjà construite | `depots-meta → flux --etat`, prêt |
| 2-4 | **Sept brouillons jetables** : sonde de version 7.3, puis `RichText`, `If`/`Switch`, `ChipsSelector`, `NavigationList`, `ImageCarousel`, `CalendarPicker` | catalogue, quantité, récapitulatif et conditionnel **dans** le formulaire — et le verdict `CalendarPicker` qui contredit ou confirme la doc | **INSTRUMENTÉ** — `flux.mjs --mesurer-composants [version]`, option `mesurer-composants` du workflow |
| 5 | Amorces et commandes : les **observer** sur un téléphone réel | l'accueil avant le premier message | un aller-retour terrain |

**Un brouillon PAR composant**, pas un brouillon à sept écrans : une erreur de
parse globale masquerait les autres verdicts. Chaque écran garde son témoin
`TextInput` — si le témoin est refusé aussi, c'est la définition ou la version
qui est cassée, pas le composant. C'est la méthode de `PhotoPicker`, étendue
d'un cran : la version se mesure d'abord.

**Où la mesure s'exécute — et pourquoi pas ici.** Le workflow `depots-meta`
lance les scripts **dans l'image Fly déployée** (« les scripts vivent dans
l'image, sous /app ») : le mode `--mesurer-composants` n'y sera qu'après le
déploiement de cette branche. D'ici là, le chemin historique reste ouvert — un
poste avec `WABOT_API_KEY` et `WHATSAPP_WABA_ID` dans son `.env`, comme les
trois premiers dépôts de formulaires. Cette session n'a ni l'un ni l'autre, et
c'est voulu : les secrets ne sortent pas de leurs coffres.

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
