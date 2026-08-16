# Dossier pour le second appel Meta — à copier tel quel

> Rédigé le 16/08/2026, à partir du **code**, pas d'une intention. Chaque
> affirmation ci-dessous est vérifiable dans ce dépôt ; les références de
> fichiers sont données pour qu'un tiers puisse contrôler.
>
> **Ne rien ajouter qui ne soit pas vrai.** Un dossier embelli qui se
> contredit à la première vérification coûte plus que le silence.

---

## 1. Description détaillée de l'entreprise

**Horizon Services Sarl** édite **Catalog**, un outil logiciel destiné aux
commerçantes camerounaises qui vendent **déjà** sur WhatsApp.

Ces vendeuses — vêtements, pagne, cosmétiques, alimentaire — tiennent leur
commerce entièrement dans des conversations WhatsApp : photos envoyées une par
une, prix négociés en message, paiements par Mobile Money (MTN MoMo, Orange
Money). Elles n'ont ni site, ni terminal de paiement, ni, le plus souvent,
registre de commerce.

Catalog ne déplace pas cette activité ailleurs. Il ajoute par-dessus la
conversation : un catalogue partageable, une aide au paiement Mobile Money, un
suivi de commande, et une réputation vérifiée.

**Modèle économique** : un abonnement de 2 500 FCFA par mois, **0 % de
commission**. Ce n'est pas un argument commercial mais une conséquence
structurelle : les fonds ne transitent jamais par un compte contrôlé par
Catalog. Ils vont du portefeuille Mobile Money de l'acheteuse à celui de la
vendeuse, en dépôt direct. Catalog n'initie, ne détient et n'encaisse rien.

**Le problème que le produit résout** : la fausse capture d'écran de paiement
Mobile Money est l'arnaque la plus courante de ce marché. Catalog rend le
paiement **vérifiable** en analysant le SMS que l'opérateur envoie à la
vendeuse, et en produisant un reçu portant l'identifiant de transaction de
l'opérateur.

---

## 2. Cas d'usage précis de l'API WhatsApp

**Toutes les conversations sont initiées par l'utilisateur.** Catalog
n'envoie jamais de message à quelqu'un qui ne lui a pas écrit en premier.

### Comment une conversation commence

- **L'acheteuse** ouvre un lien `wa.me` que la vendeuse a partagé (statut,
  groupe, conversation privée) et **écrit au numéro**. C'est son message qui
  ouvre la conversation.
- **La vendeuse** écrit au numéro pour créer sa boutique.

Aucune liste de contacts n'est importée, achetée ou constituée. Il n'existe
aucun chemin de code permettant d'envoyer un message à un numéro qui n'a pas
écrit — le numéro d'un destinataire n'entre dans le système que par un
message entrant.

### Ce que la conversation permet

| Pour l'acheteuse | Pour la vendeuse |
|---|---|
| Parcourir les articles, voir les photos | Créer sa boutique, publier un article |
| Composer un panier, passer commande | Recevoir ses commandes |
| Indiquer où livrer (ville, quartier, repère) | Coller le SMS de paiement reçu de l'opérateur |
| Recevoir un reçu vérifiable | Suivre l'avancement, marquer une livraison |
| Suivre sa commande, laisser un avis | Consulter son catalogue et ses statistiques |

### Messages sortants hors fenêtre de 24 h

Catalog utilise **sept modèles**, tous de catégorie **utility**, et tous liés
à une **transaction en cours** avec la personne qui les reçoit :

| Modèle | Destinataire | Déclencheur |
|---|---|---|
| `catalog_nouvelle_commande_v2` | vendeuse | une commande arrive sur SA boutique |
| `catalog_paiement_prouve_v2` | acheteuse | SON paiement est confirmé |
| `catalog_commande_livree_v2` | acheteuse | SA commande est marquée remise |
| `catalog_acompte_attendu_v2` | acheteuse | SA commande attend son acompte |
| *(trois autres du même régime — contestation, rappel de solde)* | | |

Aucun message promotionnel, aucune diffusion, aucune campagne marketing.
Chaque modèle porte l'identifiant de la commande concernée et invite à
répondre. Les modèles sont définis dans `apps/api/src/domain/bot/gabarits.ts`
et déposés par script, jamais à la main.

**Volumes** : le produit est en préproduction. Il n'a aucune vendeuse en
production à ce jour.

---

## 3. Politiques d'inscription (opt-in) et de désinscription (opt-out)

### Opt-in

L'inscription est **implicite et explicite à la fois** : la personne écrit
elle-même au numéro pour obtenir un service qu'elle demande. Il n'existe pas
d'autre porte d'entrée.

- Aucun numéro n'est collecté hors d'un message entrant.
- Aucune liste n'est importée ni achetée.
- La vendeuse partage son lien de boutique ; c'est l'acheteuse qui décide
  d'écrire.

### Opt-out

- **« STOP »** met fin à ce qui est en cours et arrête les envois.
- **« stop résumé »** désactive le résumé quotidien de la vendeuse. Ce
  résumé **annonce lui-même son mot de désinscription** à son premier envoi.
  La désinscription est réversible par « résumé ».
- Une conversation sans réponse retombe d'elle-même : au-delà de 24 h
  d'inactivité, l'état est réinitialisé et plus rien ne part.

### Données

Catalog ne demande, n'affiche et ne stocke **jamais** le code secret Mobile
Money. Aucune donnée de carte bancaire ne transite. Le SMS opérateur collé
par la vendeuse est analysé puis **n'apparaît dans aucune trace**.

---

## Ce qu'il faut vérifier AVANT d'envoyer ce dossier

> ⚠️ **Le point 3 décrit « STOP » comme un opt-out de messagerie. Vérifier
> que c'est bien le cas dans le code avant d'envoyer.**
>
> Mesure du 16/08/2026 : `conversation.ts:458` fait correspondre `stop` à
> **« annuler »** — c'est-à-dire *annuler la commande en cours*, pas *ne plus
> me contacter*. Ce n'est pas le sens qu'un examinateur Meta donnera au mot.
>
> Deux options, et il faut choisir avant d'envoyer :
>
> 1. **Implémenter un vrai opt-out global** — « STOP » cesse tout envoi
>    sortant vers ce numéro, tous sujets confondus, réversible. C'est la
>    bonne pratique attendue, et ça rend la phrase du dossier vraie.
> 2. **Corriger le dossier** pour ne décrire que ce qui existe : l'opt-out
>    du résumé, et l'expiration après 24 h.
>
> **Ne pas envoyer le dossier tel quel sans avoir tranché.** Décrire à Meta
> une politique qu'on n'applique pas est exactement ce qu'un examen cherche.
