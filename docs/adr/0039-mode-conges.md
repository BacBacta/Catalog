# 0039 — Le mode congés : une boutique qui sait dire qu'elle est fermée

Date : 04/08/2026 · Statut : accepté · Complète : 0031, 0035

## Contexte

Une boutique Catalog n'a aucun moyen de s'arrêter. La vendeuse part au village,
tombe malade, ou n'a plus rien à vendre : son lien continue de circuler, le bot
continue de prendre des commandes, et — c'est le point qui fait mal — **il
continue de réclamer des acomptes**.

Le produit tout entier est bâti sur une promesse : le paiement laisse une trace
opposable. Encaisser un acompte pour une commande que personne ne préparera est
exactement l'inverse de cette promesse, et c'est nous qui aurons fourni le
mécanisme. Une acheteuse dans ce cas n'a pas un problème de livraison, elle a un
problème d'argent.

Le mode congés était sur la liste P1 de l'ADR 0035. Il y est resté deux tranches
de trop.

## Décision 1 — Un champ à part, PAS `seller.status`

`SellerStatus` existe déjà, avec une valeur `closed`. Elle ne convient pas :
elle décrit le **compte** — actif, suspendu, fermé — et l'export du catalogue
public filtre sur `status: "active"`. Une vendeuse partie deux semaines
disparaîtrait de l'instantané, perdrait son référencement, et le lien qu'elle a
posté en Statut la veille tomberait sur une page absente.

Donc : `Seller.congesDepuis DateTime?` (expand). Nul = ouverte.

La **date** plutôt qu'un booléen, parce qu'elle répond à « depuis quand ? » sans
table d'historique. Chaque bascule écrit en plus dans `seller_audit_event`
(`boutique_fermee` / `boutique_rouverte`), avec son acteur — `vendeuse_app` ou
`bot_whatsapp`.

La bascule est **idempotente** : refermer une boutique déjà fermée ne repousse
pas la date et n'écrit pas au journal. La date dit depuis quand la boutique ne
prend plus rien, pas quand la vendeuse a appuyé pour la dernière fois.

## Décision 2 — Ce que ça ferme, et surtout ce que ça ne ferme pas

**Seule la création d'une NOUVELLE commande est suspendue.** Tout le reste
continue, et ce n'est pas un détail d'implémentation — c'est la raison pour
laquelle une vendeuse osera s'en servir :

| Ce qui continue | Ce qui s'arrête |
|---|---|
| La boutique reste publiée, indexée, partageable | La création d'une commande |
| Le catalogue, les fiches, les photos, les avis | *(rien d'autre)* |
| Les commandes en cours : paiement, preuve, remise, avis | |
| La conversation avec la vendeuse | |
| L'ajout d'articles (préparer sa rentrée) | |

Les messages le disent explicitement, dans les deux sens. Une vendeuse qui croit
qu'elle annule ses commandes en cours ne fermera jamais ; une acheteuse qui
croit la boutique disparue n'y reviendra pas.

## Décision 3 — Le verrou est dans le bot, l'affichage est partout

Trois endroits refusent, et ils n'ont pas la même autorité :

1. **La machine de conversation** retire « Commander » de la fiche article et
   refuse les **trois** gestes qui mènent à une commande : `cmd:*`, `commander`,
   `confirmer`. Trois et pas un, parce qu'un fil ouvert avant le départ porte
   encore ses anciens boutons et que WhatsApp laisse les appuyer.
2. **Le service, à la création**, relit la base. Entre l'affichage du
   récapitulatif et l'appui sur « Confirmer », la vendeuse a pu partir : c'est
   la base qui fait foi, exactement comme pour le stock.
3. **La boutique publique** affiche la bannière et ne monte pas l'îlot de
   commande. Mais l'instantané est figé à la construction : une vendeuse qui
   ferme à midi ne change pas ces pages avant la prochaine publication.

**Cette péremption n'est pas un défaut à rattraper.** La page statique ne prend
aucune commande — elle compose un message WhatsApp, qui arrive au bot, qui lit
la base. Le seul chemin qui crée une commande passe par le point 2. La bannière
évite d'inviter pour rien ; elle ne garantit rien à elle seule, et c'est écrit
ici pour que personne n'aille lui faire porter une garantie.

## Décision 4 — Aucune date de retour n'est demandée

Ni dans l'app, ni dans le fil, ni sur la boutique.

Une date de retour serait fausse le jour où elle passe, et personne ne la
corrigerait — la vendeuse est en congés, c'est le principe. On répéterait le
défaut que l'ADR 0038 vient de nommer sur le stock : un nombre qui ne se met pas
à jour ment plus qu'il n'informe.

Ce que les messages disent à la place : « écrivez-lui, elle seule sait quand
elle reprend ». C'est vrai, c'est actionnable, et ça ramène la conversation là
où le produit la veut.

## Décision 5 — Deux chemins, une seule écriture

`basculerConges()` vit dans `routes/seller.ts` et est appelée par l'app vendeuse
(`POST /api/vendeuse/conges`) **et** par le fil WhatsApp. Deux écritures séparées
finiraient par diverger sur le journal — or le journal est justement ce qui
permet de répondre, un jour de litige, à « depuis quand cette boutique ne prend
plus rien ? ».

**Pas d'OTP.** Fermer sa boutique ne déplace aucun argent et se défait d'un mot.
Le champ qui exige une vérification est le numéro de reversement, et lui seul
(AGENTS.md) ; en exiger une ici banaliserait celle qui compte.

Dans le fil, les deux gestes sont symétriques et acceptés au bouton comme au mot
tapé : « congés », « vacances », « je pars », « fermer » d'un côté ; « je
reprends », « rouvrir », « de retour » de l'autre. Le menu « ma boutique »
annonce le mot — un geste que personne ne connaît n'existe pas — et, en congés,
« Je reprends » prend la place de « Ma carte à partager » : mettre en avant une
boutique qui ne prend pas commande n'est pas le geste du moment.

## Ce que ça ne fait pas

- **Aucune notification aux acheteuses en cours.** Prévenir hors fenêtre de
  24 h exige un gabarit utilitaire, donc le WABA (ADR 0035). Les commandes en
  cours continuent normalement, ce qui rend l'absence de notification sans
  conséquence.
- **Aucune fermeture programmée**, ni automatique après N jours sans activité.
  Deviner qu'une vendeuse est partie serait fermer sa boutique à sa place.
- **Aucun effet sur l'abonnement.** Une boutique fermée reste une boutique ;
  la question « faut-il suspendre les 2 500 F pendant les congés ? » est une
  décision commerciale, pas une conséquence technique.
