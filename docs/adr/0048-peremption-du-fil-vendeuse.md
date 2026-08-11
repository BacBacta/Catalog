# 0048 — Un flux vendeuse abandonné périme, et la sortie de secours s'annonce

Date : 2026-08-07
Statut : accepté

## Contexte

Premier échange réussi du bot en préproduction, une fois le webhook réparé
(ADR 0046, 0047). Le message envoyé est `Hi`. La réponse reçue :

> **Hi** — son prix, en francs ?
> Exemple : 15000

Puis `Bonjour`, et :

> Je n'ai pas compris le prix. Écrivez-le en chiffres, sans virgule.

Le porteur du produit a décrit le bot comme « halluciné ». Il ne l'est pas, et
la distinction porte tout le diagnostic : **le bot n'a aucun modèle de
langage.** C'est une machine à états déterministe. Cette réponse-là est la
seule que l'état `article_nom` pouvait produire pour l'entrée `Hi` — la
machine a fait exactement ce qui était écrit. Le défaut n'est pas dans la
réponse, il est dans le fait que cet état existait encore.

## Ce qui n'allait pas

### 1. Le fil vendeuse ne périmait pas — la cause

Le fil ACHETEUSE périme depuis l'ADR 0032 : `etatApresInactivite` ramène au
catalogue un flux abandonné depuis plus de 24 h. La fonction ne traite que les
états acheteuse (`accueil`, `catalogue`, `avis_mot`…). Aucun équivalent
n'existait pour les états vendeuse, et `filInscription` lisait `etatCourant`
tel quel.

Un `article_nom` posé lors d'un essai précédent survivait donc indéfiniment.
Et comme la **règle 1** de `aiguiller` donne à une inscription en cours la
priorité absolue — à raison : un nom de boutique qui ressemble à un slug ne
doit pas renvoyer la vendeuse au catalogue au milieu de son inscription —,
cet état périmé **avalait tout message ultérieur**, sans limite de temps.

C'est le même symptôme que l'ADR 0040 (« un `Bonjour` vieux d'une minute
devenait le NOM d'une boutique »). Le 0040 en a traité une cause, la
relivraison, par la déduplication sur `wamid`. L'autre cause — l'état qui ne
meurt jamais — restait ouverte.

### 2. La sortie de secours existait, mais nulle part où on en a besoin

`annuler` / `stop` / `cancel` sont reconnus depuis l'ADR 0034, avant même
l'aiguillage sur l'état. Le mot fonctionne. Il n'était simplement **annoncé
nulle part**, et surtout pas dans les messages de reprise — ceux qu'on lit
précisément quand on ne comprend pas ce que le bot attend.

Conséquence observée dans la capture : `Bonjour` en réponse à une demande de
prix produit « Je n'ai pas compris le prix », indéfiniment. La boucle est
correcte ; elle est sans issue visible.

## Décision

**Un flux vendeuse abandonné périme, au même délai que le fil acheteuse.**
`etatVendeuseApresInactivite` rend `null` au-delà de `INACTIVITE_MAX_MS`.

Trois choix méritent d'être écrits :

- **`null`, pas un état de repli.** Il n'y a rien à reprendre au milieu d'un
  formulaire. Le message suivant doit être aiguillé comme un premier contact.
  Rien n'est perdu : ni boutique ni article n'existe avant l'effet — la
  machine ne rend que des états et des messages, le service exécute.
- **La même constante que le fil acheteuse**, importée, pas recopiée. Deux
  horloges pour une seule notion d'abandon se contrediraient un jour.
- **La péremption s'applique dans le service, avant l'aiguillage**, et non
  dans `filInscription`. La règle 1 lit `etatVendeuseEnCours` avant tout le
  reste : un état périmé doit avoir disparu à ce point-là, ou il continuerait
  de détourner le message vers le fil qu'on cherche justement à quitter.

**La sortie de secours s'annonce sur les trois messages de reprise** — nom de
boutique refusé, nom d'article refusé, prix incompris. Une ligne, à
l'endroit exact où quelqu'un est en train de se demander comment sortir.

## Ce qui n'est PAS décidé ici

**Une salutation reste un nom d'article valide dans un flux vivant.** `Hi`
passe `NOM_MIN` (2 caractères), et rien ne l'écarte. Avec la péremption, le
cas de la capture ne se reproduit plus — l'état n'existait plus depuis
longtemps. Mais une vendeuse qui tape `vendre`, reçoit « Quel est le nom de
l'article ? » et répond `Bonjour` dans la minute verra toujours `Bonjour`
devenir le nom.

Écarter les salutations demanderait une liste de mots — dans trois langues,
dont une, le pidgin, que nous avons décidé de ne pas fabriquer à la machine
(ADR 0033). Et la question de fond reste ouverte : dans un flux que la
personne vient d'ouvrir elle-même, prendre sa réponse au mot est le
comportement correct. C'est une **question produit**, signalée plutôt que
comblée (AGENTS.md §7.7).

## Conséquences

- Un essai abandonné ne pollue plus les essais suivants — ce qui compte
  d'abord pour nous, en préproduction, où le même numéro rejoue tous les
  parcours.
- Une vendeuse réellement interrompue (batterie, réseau, client au comptoir)
  reprend au menu plutôt que de rester coincée dans un formulaire dont elle
  ne se souvient plus.
- Six tests : trois sur la péremption, trois sur l'annonce de la sortie —
  dont la reproduction littérale de l'échange du 07/08/2026, `Bonjour` répondu
  à une demande de prix. Vus rouges avant d'être verts.
