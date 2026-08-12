# Runbooks

Un runbook se lit **pendant** l'incident, pas avant. Il est donc écrit pour
quelqu'un qui est réveillé à 3 h du matin, qui ne connaît pas forcément le
module concerné, et qui doit décider vite.

Chacun de ces fichiers a la même structure, et elle n'est pas décorative :

| Section | Ce qu'elle répond |
|---|---|
| **Symptômes** | Comment je sais que c'est ça, et pas autre chose |
| **Diagnostic** | Quelles commandes je lance pour en être sûr |
| **Actions** | Ce que je fais, dans quel ordre |
| **Critère de sortie** | Comment je sais que c'est fini |

Le dernier est celui qu'on oublie d'écrire, et c'est le plus important : sans
lui, un incident se termine quand quelqu'un est fatigué.

## Les cinq situations couvertes

| Runbook | Probabilité | Ce qui casse |
|---|---|---|
| [Changement de format de SMS](changement-format-sms.md) | **La plus probable** | Les preuves sont refusées en bloc. Rien ne tombe. |
| [Code USSD modifié](code-ussd-modifie.md) | Moyenne | La rampe ouvre un menu inattendu. |
| [Paiement contesté](paiement-conteste.md) | Certaine, récurrente | Une vendeuse et une acheteuse ne disent pas la même chose. |
| [Interrupteur et retour arrière](interrupteur-et-retour-arriere.md) | Inévitable au moins une fois | Un déploiement se passe mal. |
| [Restauration d'une sauvegarde](restauration-sauvegarde.md) | Rare, grave | La base est perdue ou corrompue. |

L'interrupteur est le seul de ces runbooks qui ne commence pas par un
diagnostic, et c'est délibéré : **on arrête d'abord, on comprend ensuite.** Un
interrupteur se remet en position ouverte en dix secondes ; une demi-heure de
diagnostic pendant que des preuves se perdent ne se rattrape pas.

## Et deux fichiers qui ne sont pas des runbooks

[bascule-waba-production.md](bascule-waba-production.md) se lit une fois, le
jour où 360dialog livre le canal de production : les quatre variables à poser,
celle qu'on oublie (`WHATSAPP_WABA_NUMERO` fabrique TOUS les liens `wa.me`), et
le contrôle qui atteste la chaîne média — le seul chemin que le bac à sable ne
pouvait pas vérifier.

[deploiement.md](deploiement.md) se lit avant le premier déploiement, une fois :
secrets à poser, gardes qui empêchent la machine de démarrer, et pourquoi Vercel
a besoin d'un `vercel.json` généré — il ne lit ni `_redirects` ni `_headers`.

## Et une liste qui n'est pas un runbook

[checklist-lancement.md](checklist-lancement.md) se lit **avant** l'incident,
une seule fois, avant d'ouvrir à la première vendeuse qui n'est pas dans la
pièce. Elle distingue ce qui est vérifié par une commande, ce qui reste à
décider, et les quatre points qu'aucune session de développement ne peut
cocher — infrastructure réelle, réseau camerounais réel, préproduction.

## Deux entrées de l'ancienne liste ont disparu

Ce fichier annonçait `panne-operateur.md` et `ecart-reconciliation.md`. Les deux
datent d'avant l'ADR 0009 et ne décrivent plus ce produit :

- **`ecart-reconciliation.md`** parlait d'un écart entre le grand livre et *le
  relevé de l'agrégateur*. Il n'y a plus d'agrégateur, donc plus de relevé, donc
  plus d'écart possible : Catalog ne détient aucun fonds et n'a rien à
  réconcilier. Le litige entre deux personnes existe toujours — c'est
  [paiement-conteste.md](paiement-conteste.md).
- **`panne-operateur.md`** supposait que Catalog *initie* les paiements et
  puisse donc les suspendre. Il ne les initie pas. Si MTN est indisponible, une
  acheteuse ne peut pas payer et le constate elle-même, sur son propre
  téléphone ; Catalog n'a ni levier ni information de plus qu'elle. Ce qui reste
  vrai et actionnable — un code USSD qui a changé — est
  [code-ussd-modifie.md](code-ussd-modifie.md).

Ce n'est pas un renoncement : c'est ce que l'architecture v1 rend sans objet.

## Ce qui reste à faire par un humain

Ces runbooks ont été écrits en session. Trois choses ne peuvent pas l'être, et
elles font partie de la définition de terminé du lot 14 :

1. **Une restauration effectuée pour de vrai**, sur un environnement vierge,
   avec le temps mis noté dans le runbook. Tant que ce chiffre est absent, la
   procédure est une hypothèse — et une procédure de restauration jamais jouée
   est la définition d'une sauvegarde qui n'existe pas.
2. **Chaque alerte déclenchée volontairement au moins une fois.** Une alerte
   jamais vue se découvre le jour où elle compte, et on découvre alors qu'elle
   pointe vers un tableau de bord vide ou vers un destinataire parti.
3. **Les objectifs de perte de données maximale et de délai de remise en
   service**, écrits. Ce sont des décisions de produit, pas de code : combien
   d'heures de commandes accepte-t-on de perdre, et combien de temps peut-on
   rester fermé.
