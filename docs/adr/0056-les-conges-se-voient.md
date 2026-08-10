# 0056 — Les congés se voient

Date : 2026-08-10
Statut : accepté
Révise : la surface de l'ADR 0039, pas sa décision

## Contexte

Le porteur du produit a demandé « une option qui permet au vendeur de fermer
une boutique ouverte ». Elle existait déjà, à deux endroits, depuis l'ADR 0039 :

- dans le fil WhatsApp — `congés`, `vacances`, `je pars`, `fermer`, plus des
  boutons, et `je reprends` pour rouvrir ;
- dans l'app vendeuse — *Réglages* → carte **Mode congés**.

**Qu'elle ait été demandée est le défaut.** Une fonction qu'on ne trouve pas
n'existe pas, et ce n'est pas au porteur du produit de la connaître mieux que
ses vendeuses.

## Le défaut, et pourquoi il coûte dans un seul sens

Fermer est réversible et sans dégât : les commandes en cours vont au bout, la
boutique reste publiée, la vendeuse reste joignable. **Rouvrir, en revanche,
ne se rappelle à personne.**

Une vendeuse qui oublie de rouvrir perd toutes ses ventes **sans un signe** :
le lien fonctionne, le catalogue s'affiche, les acheteuses écrivent — et se
font refuser au dernier verrou, celui de la création de commande. Côté
vendeuse, cela ne ressemble à rien de particulier. Cela ressemble à « personne
n'achète ».

L'écran d'accueil, lui, ne disait rien du tout. Or c'est le seul écran qu'une
vendeuse ouvre tous les jours ; `Réglages` est un écran qu'on ouvre quand on
cherche quelque chose, et une boutique fermée n'est pas quelque chose qu'on
cherche : c'est quelque chose qu'on oublie.

## Décision 1 — l'état fermé se dit sur l'accueil, en haut

Un bandeau paraît **avant tout le reste**, y compris avant le chiffre des
soldes — qui vaudrait zéro pour la même raison qu'elle ignore.

Il dit trois choses, dans cet ordre : que la boutique ne prend pas de
commande, **depuis combien de temps**, et ce qui continue malgré tout. La
durée est en jours et non en date : « depuis 6 jours » se lit, « depuis le
4 août » se compte.

## Décision 2 — l'état ouvert ne dit RIEN

Pas de bandeau vert, pas de « tout va bien ».

Un bandeau permanent devient un meuble : on cesse de le voir, et il ne sert
plus le jour où il compte. Le silence est ce qui donne au bandeau sa force
quand il paraît.

C'est la même discipline que le reste du produit — on ne dit que ce qui change
quelque chose.

## Décision 3 — le geste de retour est DANS le bandeau

Pas un lien vers l'écran où le geste se trouve : le bouton lui-même,
« Je reprends les commandes », sous le pouce.

Un rappel qui demande deux taps pour être suivi est un rappel qu'on remet à
plus tard — et « plus tard » est précisément le mode d'échec qu'on corrige.

Le ton est `warn`, jamais `danger` : rien n'est cassé, rien n'est perdu. C'est
un état choisi, qui dure peut-être trop.

## Décision 4 — une seule implémentation, deux surfaces

`apps/seller/src/components/conges.tsx` porte la requête, l'état local et le
message d'erreur. `Réglages` et l'accueil le consomment.

Deux copies auraient dérivé, et c'est toujours celle qu'on ne regarde pas qui
se met à mentir — ici, à afficher « ouverte » sur une boutique fermée.

## Ce que cet ADR ne change pas

- **Aucune date de retour n'est demandée**, nulle part. Elle serait fausse le
  jour où elle passe, et personne ne la corrigerait (ADR 0039, ADR 0038).
- **Le verrou reste dans le service**, à la création de la commande. La machine
  et la boutique publique ne font qu'afficher, et l'instantané statique est
  périmé par construction.
- **Rien ne change dans le fil WhatsApp** : il annonçait déjà le geste en clair
  dans « ma boutique », et affichait déjà 🌴 quand la boutique est fermée.

## Ce qui est vu et NON fait

**La fermeture définitive n'existe toujours pas**, et c'est délibéré. La
proposer exigerait d'arbitrer quatre choses, dont trois se retournent contre
le produit :

1. les commandes en vol — une commande payée non livrée ne peut pas disparaître ;
2. **les reçus déjà émis** — ils doivent rester vérifiables, c'est la valeur
   n° 1 du produit ; un reçu qui rend « boutique inconnue » détruit la promesse
   pour tout le monde ;
3. les avis vérifiés — les effacer permettrait de laver une réputation en
   fermant puis rouvrant ;
4. `Seller.phone` est UNIQUE, et c'est l'anti-squat des boutiques : le libérer
   ouvre la reprise d'un slug, le garder empêche la vendeuse de revenir.

Si le besoin est constaté, la forme à instruire est une **archive** — retirée
de la vitrine, n'acceptant plus rien, reçus et avis toujours vérifiables,
numéro toujours pris — et non une suppression.

**Aucune notification de vente refusée.** Une vendeuse fermée ne sait pas
qu'une acheteuse s'est présentée. Le dire supposerait un message sortant hors
fenêtre, donc un gabarit, donc un coût — c'est une décision de palier payant,
pas un détail d'écran.

## Conséquences

- `Réglages` perd sa copie de la bascule et consomme le module commun ; son
  contenu et ses libellés ne changent pas.
- L'app vendeuse n'a pas de tests unitaires ; ce lot n'en introduit pas. La
  vérification est visuelle, et c'est dit ici plutôt que sous-entendu.
