# 0061 — Deux comptoirs, un moteur

Date : 2026-08-11
Statut : accepté
Portée : **structurant** — cet ADR se cite, comme le 0009 se cite pour le paiement
Prolonge : 0009 (v1 sans agrégateur), 0031 (le cap bot-first), 0035 (le bot premium)
Maquette : `docs/terrain/architecture-deux-comptoirs.html`

## Pourquoi cet ADR existe

Le produit a deux ères, et personne ne les avait recousues.

L'ère **web-first** (lots 5 à 12) : la boutique Astro mène vers la vendeuse,
qui gère dans son app. L'ère **bot-first** (ADR 0031 et suivants) : le fil fait
tout, sur le numéro partagé. Les deux sont bonnes. Aucune ne dit ce que fait
l'autre, et le silo se lit dans le code :

- **une seule ligne du dépôt crée une commande** — `bot.ts:1468`, le parcours
  acheteuse. L'app vendeuse liste, avance, déclare : elle ne crée pas ;
- **la fiche produit web contourne le moteur** — `[produit].astro:42` pointe
  `wa.me/<numéro personnel de la vendeuse>`. L'acheteuse qui clique atterrit
  dans une conversation humaine : aucune commande, pas de rampe, pas de preuve,
  pas de reçu, pas de statistique ;
- **une boutique née dans le fil n'a pas de page web** tant qu'un instantané
  n'a pas été reconstruit.

## Ce que le terrain a montré

Onze scénarios ont été écrits contre les habitudes réelles. Trois ont changé
le modèle ; les autres ont validé des choix déjà faits.

**La vente naît au statut.** Mama Ngo poste cinq photos à 6 h ; une cliente
**répond au statut** ; elles négocient (« dernier prix ? ») ; la vente se
conclut. Cette réponse arrive **sur le numéro personnel de la vendeuse** — on
ne peut pas la rediriger, et on ne le voudrait pas : « l'acheteuse et la
vendeuse continuent de se parler sur WhatsApp » est un invariant produit.

Conséquence : **le moteur ne voit pas la vente majoritaire du pays.** Un
produit qui ne sait formaliser que la commande self-service formalise la
minorité.

**Le prix se négocie.** Un comptoir à prix fixe est contourné, pas suivi. La
commande doit pouvoir naître **au prix convenu**.

**L'acompte fait peur, symétriquement.** La fausse capture MoMo est l'arnaque
n° 1 ; envoyer un acompte à une inconnue est la peur n° 2. Catalog ne peut pas
séquestrer (ADR 0006, 0009), donc le seul outil est la **réputation montrée au
moment du doute** — et la salle de vérification publique cesse d'être une
commodité : c'est l'infrastructure qui rend l'acompte possible.

## La décision

**Deux comptoirs, un moteur, des surfaces qui lisent, et une boucle.**

Trois règles, dont tout le reste découle :

1. **Le moteur est le produit.** Il existe, il est pur, il est testé. Aucune
   surface n'en devient un second.
2. **Une commande naît à un comptoir, et il y en a deux** — celui de
   l'acheteuse (self-service, prix affiché) et celui de la vendeuse
   (formalisation d'une vente négociée, prix convenu). Jamais un troisième.
3. **Aucune porte ne contourne le moteur.** Un « commander » qui ne crée pas
   de commande n'est pas un bouton, c'est une fuite.

### Le comptoir vendeuse — la porte qui manquait

La vendeuse écrit dans son fil Catalog ce qu'elle vient de vendre. Le moteur
crée la commande **au prix convenu**, puis lui rend un **message de paiement
autosuffisant** — référence, code de vérification, acompte, numéro de
reversement, code USSD — qu'elle **transfère à sa cliente**, dans leur
conversation à elles.

La transaction ne change pas de mains : elle change de pièce. La relation
reste dans le fil humain ; l'argent, la preuve et le reçu passent par le
moteur.

### La position du catalogue web

Il n'est **pas** un second comptoir. Il a trois métiers que WhatsApp ne sait
pas faire :

- **la vitrine consultable** — indexable, partageable, lisible sans compte ni
  WhatsApp, légère (≤ 30 Ko de JS) ;
- **la salle de vérification** — `/v/` et le suivi, publics et hors WhatsApp,
  parce qu'un tiers doit pouvoir contrôler un reçu sans rien installer ;
- **l'entonnoir** — « Commander » dépose dans le fil du bot avec le mot-clé de
  la boutique et le canal ; « Parler à la vendeuse » garde le lien humain.

**Pourquoi pas un vrai paiement web ?** Parce que la preuve est
structurellement conversationnelle : c'est la vendeuse qui colle son SMS. Un
parcours web s'arrêterait de toute façon à la porte du paiement et renverrait
vers le fil — on aurait construit une seconde machine pour s'arrêter au même
endroit.

### La boucle

Chaque vente prouvée fabrique la munition de la suivante : après un avis
vérifié, une **carte d'avis** que la vendeuse reposte à son statut. Aucune
concurrente ne peut poster ça — aucune ne peut le prouver.

## Ce que le modèle tranche d'avance

| Question | Réponse |
|---|---|
| Où naît une commande ? | Dans le moteur, par un des deux comptoirs. |
| Vers où pointe « commander », où qu'il soit ? | Le bot, mot-clé + canal marqué. |
| Le numéro personnel de la vendeuse ? | Le lien humain. Jamais le comptoir. |
| Un prix négocié ? | Le catalogue affiche le prix de départ ; la commande se crée au prix convenu. |
| Une boutique née dans le fil a-t-elle sa page web ? | Oui — la reconstruction est une conséquence du modèle, pas une option. |
| Paiement depuis le téléphone d'un proche, d'un call-box ? | Avertissement, jamais rejet. La clé est l'identifiant de transaction. |
| Si le bot tombe, ou si Meta bannit le numéro ? | Le catalogue, `/v/`, le suivi et l'app vendeuse restent debout. C'est la redondance voulue. |
| La revendeuse ? | Elle ouvre SA boutique. Une porte pour elle, rien contre elle. |
| Qui écrit = qui possède ? | Jamais supposé. La nièce tape, la tante encaisse. |
| Statut et chaîne ? | De la distribution : des liens et des images marqués. Jamais un état. |
| Place de marché, catalogue natif WhatsApp ? | Des rendus multi-boutiques de la même vérité. Décisions séparées. |

## Les cinq « jamais »

- **Jamais de troisième comptoir.**
- **Jamais de fonds chez Catalog** — pas de séquestre « pour rassurer ».
- **Jamais un parcours qui exige un lien externe** : le forfait « WhatsApp
  seul » est la norme, tout parcours critique se termine en texte brut.
- **Jamais un rejet sur le seul numéro discordant.**
- **Jamais une surface qui garde sa propre vérité.**

## Ce qui reste ouvert, et le reste

- **L'expédition par agence de voyage.** `payMode: integral` existe déjà ; le
  mode de livraison, non. Le vocabulaire réel se demande à Douala — il ne
  s'invente pas (AGENTS.md §7.7).
- **Le catalogue natif WhatsApp** est limité à un par numéro. Le contournement
  (un catalogue, des sets par boutique, envois filtrés) et la vraie réponse
  (un numéro par vendeuse au palier payant) sont deux décisions produit.
- **La place de marché** — un rendu, pas un moteur. Décision séparée.
- **Le mode revendeuse** outillé : idée de v2.

## L'ordre de marche

| Rang | Chantier |
|---|---|
| 0 | Recâblage : CTA web → bot, rebuild de la boutique, vocabulaire des canaux |
| 1 | Le comptoir vendeuse |
| 2 | Réputation au moment de l'acompte · alerte à l'ancien numéro au changement de reversement |
| 3 | Distribution : pack statut, chaîne, carte d'avis |

Le sprint **« le bot devient une application »** (Flows, localisation,
indicateurs de saisie, boutons natifs) est **orthogonal** : il n'ajoute ni
comptoir ni vérité, il rend les comptoirs existants plus dignes. Il peut donc
se mener avant ou pendant, sans rouvrir cet ADR.

## Conséquences

- La maquette cliquable `docs/terrain/architecture-deux-comptoirs.html` est
  l'exposé de référence : elle distingue à l'œil ce qui existe de ce qui est
  proposé, et se rejoue quand une copie change.
- Toute décision future qui contredit une ligne du tableau ou un des cinq
  « jamais » n'est pas un détail d'implémentation : c'est cet ADR qu'on rouvre,
  et ça se fait par un ADR qui le dit.
