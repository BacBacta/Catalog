# 0057 — Les congés parlent dans le fil

Date : 2026-08-10
Statut : accepté
Prolonge : l'ADR 0056, sur la surface qui compte vraiment
Concerne : `domain/bot/inscription.ts`, `bot.ts`

## Contexte

L'ADR 0056 a rendu l'état fermé visible sur l'accueil de l'app vendeuse. Le
porteur du produit a répondu : *« tu dois déployer ça plutôt dans le flow du
bot WhatsApp »*.

Il a raison, et pour deux raisons qui se cumulent :

1. **Catalog est bot-first** (ADR 0031, ADR 0034). Une vendeuse s'inscrit,
   publie ses articles et prouve ses paiements dans le fil. L'app vendeuse est
   l'endroit des chiffres et du reversement — pas celui du quotidien.
2. **L'app n'est pas déployée par nous.** Le bandeau de l'ADR 0056 attend un
   redéploiement Vercel ; le bot vit sur Fly, et part le jour même.

## Le principe : parler quand le silence serait un mensonge

Le fil annonçait déjà l'état dans « ma boutique » — un menu qu'on ouvre quand
on cherche quelque chose. Or **une boutique fermée n'est pas quelque chose
qu'on cherche : c'est quelque chose qu'on oublie.**

La tentation serait de rappeler l'état à chaque message. C'est refusé : un
rappel permanent devient un meuble, on cesse de le voir, et il ne sert plus le
jour où il compte. Pire, il transforme un état choisi en reproche.

La règle retenue est plus étroite et plus forte : **le congé parle aux moments
où il contredit ce que la vendeuse est en train de faire.** Deux moments, et
deux seulement.

## Moment 1 — elle publie un article

Le message disait : *« ✅ Robe wax — 15 000 F est en ligne. »*

C'est vrai, et c'est trompeur : l'article s'affiche, et aucune commande ne peut
naître. Ranger son stock est précisément le geste d'une vendeuse qui a oublié
qu'elle était fermée — c'est donc là qu'il faut le dire.

Le rappel s'ajoute au message, et un bouton **« Je reprends »** prend la
première place parmi les trois.

**L'état se relit dans la base à ce moment-là**, pas dans l'état de
conversation : elle a pu fermer depuis l'app ou depuis un autre appareil entre
deux messages. C'est la même discipline que le verrou de création de commande
(ADR 0039) — la base fait foi.

## Moment 2 — elle demande sa carte à partager

Une carte-vitrine postée en Statut pendant les congés attire des acheteuses
qui seront refusées au dernier verrou. Le rappel part **après** la carte : la
carte reste l'objet du geste, le rappel est ce qu'on lit ensuite.

## Ce que le rappel dit, et ce qu'il ne dit pas

Il dit **ce qui est fermé et ce qui reste ouvert**. Sans la seconde moitié,
une vendeuse peut croire que sa boutique a disparu — et ne fermera plus
jamais, ce qui la ramène à accepter des commandes qu'elle ne peut pas honorer.

Il ne dramatise pas. Rien n'est cassé, rien n'est perdu : c'est un état choisi
qui dure peut-être trop. Un test refuse les mots « erreur », « problème »,
« attention ».

Il **porte le geste lui-même**, jamais un renvoi vers l'écran qui le porte. Un
rappel à deux taps se remet à plus tard, et « plus tard » est exactement le
mode d'échec qu'on corrige. L'identifiant `rouvrir` est déjà routé depuis
n'importe quel point du fil vendeuse (ADR 0039, aiguillage règle 3).

## Ce qui est vu et NON fait

**Aucune relance périodique.** Un travail pg-boss qui écrirait « vous êtes
fermée depuis 9 jours » serait utile — et c'est un message sortant, donc
soumis à la fenêtre de 24 h, donc un gabarit et un coût. C'est une décision de
palier payant (ADR 0054), pas un détail d'écran.

**Aucun rappel sur les autres gestes.** Coller un SMS, marquer une commande
livrée, consulter ses soldes : ces gestes concernent des commandes **déjà
créées**, que les congés n'affectent pas. Y ajouter un rappel serait du bruit,
et le bruit est ce qui rend les rappels invisibles.

**Aucune notification de vente refusée** — même raison qu'à l'ADR 0056 : elle
supposerait d'écrire hors fenêtre.

## Conséquences

- 6 tests neufs sur le domaine, vus rouges d'abord.
- `messageArticlePublie` prend un troisième paramètre, **par défaut `false`** :
  aucun appelant existant ne change de comportement.
- L'app vendeuse garde le bandeau de l'ADR 0056. Les deux surfaces disent la
  même chose ; celle du fil part aujourd'hui.
