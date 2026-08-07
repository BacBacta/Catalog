# 0035 — La preuve d'origine du webhook a deux formes, et le numéro de test en a une seule

- Statut : accepté
- Date : 07/08/2026
- Concerne `apps/api/src/routes/whatsapp-entrant.ts`, `apps/api/src/server.ts`,
  `.env.example`, `docs/runbooks/bascule-360dialog.md` (nouveau)
- **Complète** les ADR 0027 (webhook entrant) et 0031 (cap bot WhatsApp).
  Ne révise ni l'un ni l'autre : le verrou reste obligatoire, c'est sa **forme**
  qui gagne une seconde variante.
- N'ajoute aucune dépendance, aucune colonne, aucune migration

## Contexte

Le 07/08/2026, un canal 360dialog (« Horizon services ») est apparu prêt, avec
un **numéro de test généré par Meta**, l'écran « Direct API Access » ouvert et
le webhook pointé sur `catalog-api-preprod.fly.dev/api/whatsapp/entrant/<secret>`.

Le chemin était bon, et pourtant rien n'aurait fonctionné. Deux raisons, et la
première tenait dans une ligne de `server.ts` :

```ts
if (secretEntrant && secretAppMeta) {   // ← la route n'existe pas sans les DEUX
```

`WHATSAPP_APP_SECRET` est un objet de la **Meta directe** : il vit dans la
console développeur d'une application Meta. Un WABA servi par un partenaire n'en
a pas, et n'en aura jamais. La condition rendait donc la route **inatteignable
par construction** sur le seul chemin que le produit emprunte aujourd'hui — un
404 sur le webhook, quel que soit le reste de la configuration.

L'ADR 0031 avait bien prévu le verrou de remplacement (`WABOT_WEBHOOK_AUTH`,
l'en-tête `Authorization` rejoué par 360dialog) et la route sait déjà le
vérifier. Ce qui manquait était le montage : le verrou existait, mais la porte
sur laquelle le poser ne se construisait pas.

## Décision

### 1. La preuve d'origine est obligatoire ; sa forme dépend du transporteur

La route exige `WHATSAPP_ENTRANT_SECRET` **et au moins l'une** de :

- `WHATSAPP_APP_SECRET` — signature `X-Hub-Signature-256`, Meta directe ;
- `WABOT_WEBHOOK_AUTH` — en-tête rejoué, relais 360dialog.

Aucune des deux : la route ne se monte pas, et `whatsappEntrantRoutes` **lève à
la construction** plutôt que de servir une porte ouverte. C'est la leçon de
MboaSMS (ADR 0026) et de l'envoyeur du bot : mieux vaut un service qui refuse de
démarrer qu'un service qui écoute sans verrou.

La règle d'arbitrage entre les deux formes, elle, ne change pas d'un iota :
**une signature présente et fausse reste un refus**, l'en-tête ne vaut que
lorsque aucune signature n'est fournie.

### 2. Ne pas savoir vérifier n'est pas vérifier

Sans secret d'application, une livraison qui porte une signature est **refusée**,
pas acceptée. C'était le raccourci tentant — « on ne peut pas la lire, passons » —
et il aurait transformé l'en-tête en verrou contournable par quiconque ajoute un
en-tête `X-Hub-Signature-256` bidon. Un test le tient (`connexion-whatsapp-flux.test.ts`).

### 3. On ne pose PAS un faux `WHATSAPP_APP_SECRET`

L'issue « poser une valeur aléatoire pour débloquer le montage » fonctionnait,
et elle a été écartée. Elle est sûre au sens strict — personne ne fabrique une
signature valide contre un secret aléatoire —, mais elle installe dans
l'environnement de production une variable qui **ment sur ce qu'elle protège**.
Le jour d'un incident, la question « la signature Meta est-elle active ? » aurait
reçu la réponse « oui, la variable est posée », et elle aurait été fausse.
`.env.example` l'interdit explicitement.

### 4. Ce que le numéro de test permet — et ce qu'il ne permet pas

Le numéro est **généré par Meta à des fins de test**. Il ne devient pas le numéro
du produit : il est jetable, et le numéro de production sera **différent**.
Trois conséquences, dans l'ordre où elles mordent :

- **Le fil acheteuse complet est testable dès maintenant.** Toute la conversation
  des sprints A et B est de la **réponse en session** : l'acheteuse écrit la
  première par lien `wa.me`, la fenêtre de 24 h s'ouvre, et tout ce que le bot
  renvoie est du texte libre. **Aucun gabarit approuvé n'est nécessaire** — c'est
  déjà ce que disait l'ADR 0027 pour la réception, et cela vaut pour le bot
  entier. Le backlog « post-WABA » (notification vendeuse, relance post-24 h,
  statuts) reste bloqué, lui, parce qu'il sort de la fenêtre.
- **Les destinataires sont sur liste d'autorisation.** Un numéro de test Meta
  n'écrit qu'à un petit nombre de numéros déclarés. Le nombre exact et la
  procédure de déclaration **restent à constater sur ce canal** : ils ne sont
  pas inventés ici. Conséquence pratique : le test de terrain à Douala se
  prépare en déclarant d'abord les numéros des testeuses.
- **Rien de durable ne doit porter ce numéro.** Pas dans `WHATSAPP_WABA_NUMERO`
  de production, pas dans un lien `wa.me` imprimé, pas dans une capture montrée
  à une vendeuse. La question de confiance soulevée le 07/08 — un `+1` qui
  demande de payer à Douala est la forme exacte de l'arnaque que le produit
  combat — n'est pas tranchée par cet ADR : elle est **reportée au choix du
  numéro de production**, où elle se pose pour de bon.

La PLBV reste donc le jalon d'ouverture aux vendeuses réelles. Ce canal de test
avance la validation technique, il ne l'avance pas d'un jour.

## Où se pose l'en-tête — mesuré le 07/08/2026

Cette section a d'abord été écrite « à confirmer » : l'écran *Getting started*
du Hub n'offre qu'un champ URL, et l'hypothèse était que l'en-tête se posait par
l'API de configuration du webhook. **L'hypothèse était fausse**, et elle est
remplacée ici par la mesure — c'est le sens du §7.7 d'`AGENTS.md` : un point
marqué « à confirmer » se promeut par une constatation datée, jamais en silence.

La pose se fait **dans le Hub**, par la boîte de dialogue **« Edit WABA
Webhook »**, qui porte une section `Custom Headers` (« Headers sent with each
webhook request ») en paires nom / valeur. Le champ URL de l'écran d'accueil
n'est qu'un raccourci vers la même configuration, amputé de cette section.

Deux conséquences pratiques :

- la mise en service ne demande **aucun appel d'API** : URL, en-tête
  `Authorization`, Save ;
- la même boîte porte un bouton **« Send test request »**, et il constitue le
  meilleur contrôle du verrou — meilleur qu'un vrai message, parce qu'il ne
  dépend ni de la liste d'autorisation ni d'un téléphone. Son corps n'est pas
  une livraison WhatsApp valide, ce qui ne change rien : la route répond `200`
  dès que le verrou passe, le JSON illisible étant déjà traité comme un message
  ordinaire (ADR 0027 — répondre autre chose ferait re-livrer en boucle).

Le tableau de diagnostic du runbook en découle : `200` = verrou bon, `401` =
en-tête absent ou faux, `404` = secret d'URL faux. Trois codes, trois causes,
sans lire un journal.

## Conséquences

- `WHATSAPP_APP_SECRET` devient optionnel dans `WhatsAppEntrantDeps` ; le
  comportement en Meta directe est inchangé, et ses tests existants passent tels
  quels — c'est la garantie que la porte ne s'est pas élargie.
- Cinq tests ajoutés : livraison acceptée par en-tête, en-tête faux, en-tête
  absent, **signature présente sans secret d'application**, et refus de
  construction sans aucun verrou.
- Un runbook de bascule (`docs/runbooks/bascule-360dialog.md`) décrit l'ordre
  des opérations et le diagnostic du silence.
