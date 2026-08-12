# ADR 0031 — Le cap bot WhatsApp : la conversation devient l'interface

- **Statut** : accepté
- **Date** : 01/08/2026
- **Concerne** : `apps/api/src/domain/bot/` (nouveau), `apps/api/src/adapters/`,
  `apps/api/src/routes/whatsapp-entrant.ts`, `packages/db` (état de
  conversation), et le RÔLE de `apps/shop` et `apps/seller`
- **Révise** l'orientation d'interface de la v1 (boutique web + PWA comme
  interfaces principales). **Ne révise pas** l'ADR 0009 : l'architecture sans
  agrégateur, le dépôt direct et la preuve par SMS sont inchangés.
- **S'appuie sur** la maquette `docs/maquettes/bot-whatsapp.html`, l'ADR 0027
  (webhook entrant) et l'exploration 360dialog du 01/08/2026.

## Contexte

L'idée fondatrice du produit était un bot WhatsApp servant de
catalogue-boutique. La v1 a construit autre chose — boutique statique, PWA
vendeuse — parce que le WABA exigeait une vérification d'entreprise sans
guichet praticable. Deux choses ont changé le 01/08/2026 :

1. Le porteur du produit a retranché le cap : « migrer l'entièreté du projet
   sur le bot WhatsApp ». La dérive par rapport à l'idée fondatrice était
   réelle, et chaque écran de plus l'aggravait.
2. L'exploration 360dialog a montré un chemin praticable : sandbox immédiat,
   API au format Cloud API (notre webhook et nos charges utiles se
   transposent), et surtout la **PLBV** — vérification menée par le
   partenaire, documents d'entreprise (RCCM), réponse Meta sous ~48 h.

## Décision

**La conversation WhatsApp devient l'interface principale du produit, pour
l'acheteuse comme pour la vendeuse.** Un seul numéro, porté par Catalog ; la
conversation humaine reste sur le numéro personnel de la vendeuse
(bouton « Parler à … »).

- **Fil acheteuse** : entrée par lien `wa.me` pré-rempli, catalogue en
  messages-listes, commande guidée (quantité, mode, quartier + repère +
  téléphone — jamais d'adresse), récapitulatif canonique (AGENTS.md),
  rampe de paiement, reçu, contre-signature, avis vérifié.
- **Fil vendeuse** : notification de commande (gabarit « utility »), collage
  du SMS opérateur DANS le chat → sept contrôles → reçu émis, avancement
  d'étape par boutons, mots-clés sobres (« solde », « commandes »). Pas d'IA
  conversationnelle : un menu déterministe, comme un USSD.

**Le web passe en rôle de support.** Rien n'est supprimé, et deux morceaux y
restent par NATURE :

- **le reçu public `/v/`** — une preuve opposable se montre à des tiers qui
  n'ont pas le bon fil WhatsApp ouvert ; c'est un lien, il le reste ;
- **la gestion des photos** du catalogue (téléversement, recadrage, gain de
  poids affiché) — un chat est le pire outil du monde pour cela ;
- s'y ajoutent le reversement (OTP vers le nouveau numéro — il ne PEUT pas
  arriver sur le fil du bot : il atteste le contrôle d'une autre puce) et
  les statistiques.

## Le canal : Cloud API, avec 360dialog comme voie d'accès

Le moteur parle le **format Cloud API de Meta** (`messaging_product:
"whatsapp"`, messages interactifs). 360dialog l'expose tel quel
(`https://waba-v2.360dialog.io/messages`, en-tête `D360-API-KEY`) et son
sandbox permet de répéter sans WABA. L'adaptateur d'envoi est **dormant** :
sans `WABOT_API_KEY`, rien n'est monté — le même geste que le WABA, les
passkeys et Google.

Configuration (`.env.example`) :

- `WABOT_API_KEY` — la clé D360 (sandbox ou production). Absente = bot éteint.
- `WABOT_BASE_URL` — `https://waba-sandbox.360dialog.io` ou
  `https://waba-v2.360dialog.io`. Un défaut sûr n'existe pas : la variable est
  exigée dès que la clé est posée.
- `WABOT_WEBHOOK_AUTH` — voir sécurité ci-dessous.

## Sécurité du webhook — l'HMAC ne survit pas au relais

Les webhooks 360dialog **ne sont pas signés** (`X-Hub-Signature-256` est un
mécanisme Meta directe). Le double verrou de l'ADR 0027 devient :

1. le secret d'URL (inchangé, comparaison en temps constant) ;
2. un **secret d'en-tête** : 360dialog rejoue tel quel l'en-tête
   `Authorization` configuré sur le webhook ; sa valeur vit dans
   `WABOT_WEBHOOK_AUTH` et se compare en temps constant.

Quand les messages arrivent en Meta direct (WABA en propre, sans relais),
l'HMAC reprend du service — le code garde les deux chemins et choisit selon
la configuration présente.

## Le SMS collé transite par Meta — dit, pesé, accepté

L'ADR 0023 a banni le SMS brut de NOS traces, et cette règle est inchangée —
elle s'appliquera aux journaux du bot comme au reste. Mais un SMS collé dans
la conversation transite par les serveurs de Meta (chiffré en transit vers
l'API, traité par leur infrastructure). C'est accepté, pour trois raisons :

1. le même SMS transite déjà par l'opérateur qui l'a émis et par le clavier
   du téléphone ; Meta n'apprend rien que l'écosystème ne sait déjà ;
2. l'alternative — interdire le collage dans le chat — viderait le cap de
   son sens : c'est LE geste que le bot améliore ;
3. le contenu (montant, identifiant de transaction) est celui d'un reçu que
   la vendeuse montre de toute façon.

Ce qui ne transite JAMAIS par le chat : le code secret mobile money (aucun
écran, aucune question ne le demande — règle AGENTS.md), et le code OTP de
reversement (canal SMS séparé, précisément parce qu'il atteste une autre
puce).

## Ce qui est dit et non comblé (AGENTS.md §7.7)

- **Le bouton de paiement ne peut pas porter `tel:`** (boutons WhatsApp =
  `https` uniquement). Le bouton mène à la page `/payer` existante, le code
  d'entrée USSD est répété en texte. Le comportement réel sur téléphone
  camerounais est **à confirmer à Douala**, comme les raccourcis de l'ADR
  0020.
- **La tarification Meta par conversation n'est pas encore chiffrée contre
  le volume réel** — il n'y a pas de volume réel. Le plan 360dialog Regular
  (~49 €/mois, frais Meta au coûtant) est un coût fixe de plateforme ; le
  point de bascule se calculera avec les premières semaines de données.
- **La fenêtre de 24 h impose des gabarits pré-approuvés** pour les
  notifications sortantes (nouvelle commande → vendeuse). Leur rédaction et
  leur approbation sont un chantier à part, après le WABA.

## Conséquences

- Le moteur de conversation vit dans `src/domain/bot` — pur, sans réseau ni
  horloge implicite, testé d'abord, comme `proof` et `order`. Le webhook
  route : défis de connexion d'abord (ADR 0027, inchangé), bot ensuite.
- L'état de conversation est persisté (table `bot_conversation`, migration
  en expand pur) : un menu sans mémoire obligerait l'acheteuse à tout
  répéter à chaque message.
- La boutique publique et la PWA ne reçoivent plus d'évolution d'interface
  au-delà du support de leurs rôles résiduels. Les budgets de performance et
  les gardes existants restent en CI : ce qui est en ligne reste tenu.
- Le lancement dépend du sandbox (immédiat) puis de la PLBV (dossier RCCM,
  ~48 h une fois soumis) — plus aucun jalon n'attend la vérification Meta
  classique.
