# ADR 0105 — le récapitulatif d'absence

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0035, 0054 · Répond à la question du 14/08 : « comment éviter
que la vendeuse soit saturée de messages de commandes et ne se retrouve pas ? »

## Ce que Meta offre, vérifié avant d'inventer

**Rien.** L'API Cloud ne connaît que le message : il n'existe ni file
d'attente, ni regroupement, ni centre de notifications côté plateforme. Les
deux seuls objets propres à la « gestion » de messages sont la fenêtre de
service de 24 h et les gabarits payants hors fenêtre — tous deux déjà employés
(ADR 0035, 0054). Le « catalogue natif + panier » de WhatsApp Commerce
existerait, mais il attend le WABA (CLAUDE.md) et ne traite pas la saturation :
il en produit.

La solution est donc à nous, et elle a deux moitiés :

1. **la notification informe** — ce que ce lot améliore ;
2. **le registre retrouve** — un mot (« commandes ») qui liste les commandes
   ouvertes ; conçu ici, PAS ENCORE construit (tâche #17).

## Le défaut mesuré

Une vendeuse absente plus de 24 h accumule ses notifications dans
`bot_notification`. À son retour, `livrerNotificationsEnAttente` en remettait
**jusqu'à cinq, chacune en message entier**, mêlées à sa conversation en
cours : cinq pavés d'affilée, la commande du matin noyée sous celle du soir.
L'information y était ; la retrouver, non.

## Décision — un récapitulatif, deux exceptions

Ce qui se résume part en **UN message** : une ligne par événement — la
**première ligne** de chaque notification, qui est déjà son titre
(« *CT-240812 est créée.* ») —, le compte, et où trouver le détail. Le détail
n'est pas perdu : il ne vivait pas dans la notification mais dans la
**commande**, que l'espace vendeuse affiche.

Deux choses ne se résument **jamais**, et la règle tient dans une fonction
(`estResumable`) :

- **les notifications à boutons** (contre-signature, avis — ADR 0036) : un
  bouton ne se résume pas, le perdre couperait la preuve à deux voix ;
- **les avertissements** (corps ouvrant par ⚠️) : une contestation gèle une
  commande, elle mérite son message entier.

Le plafond change de nature : `REMISES_MAX = 5` comptait des messages, le
récapitulatif compte des **sujets** (10). Au-delà, le débordement est **dit**
(« … et N de plus, au prochain message ») et reste en file — jamais avalé.

## La règle de copie qui a failli casser ce lot

Le premier brouillon du récapitulatif se fermait sur « écrivez *commandes* » —
un mot que le bot **ne connaît pas encore**. C'est exactement la faute de
l'amorce « Voir une boutique » (ADR 0103) et des commandes du menu « / »
(ADR 0104), attrapée ici avant d'être livrée : **une copie ne promet que des
gestes qui existent**. Un test le tient au mot — le récapitulatif renvoie à
l'espace vendeuse, qui existe, tant que le registre n'est pas construit.

## Le registre — conçu, non construit

Le mot « commandes » (et son alias `/commandes` à poser au menu du numéro)
rendra la liste des commandes **ouvertes** de la vendeuse, groupées par étape,
en message liste — dix lignes au plus, une ligne ouvre le détail. C'est la
moitié « retrouver » : la notification peut alors rester courte, puisque tout
se retrouve. Quand il existera, la ligne de clôture du récapitulatif le
proposera — pas avant.
