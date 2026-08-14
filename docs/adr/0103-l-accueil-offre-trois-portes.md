# ADR 0103 — l'accueil offre trois portes, pas une

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0034, 0087

## Contexte — ce que voit une inconnue qui écrit au numéro

Deux mécanismes, et **un seul** existe avant qu'elle écrive :

1. **Les amorces** (« ice breakers ») et les commandes, posées sur le NUMÉRO
   et rendues par WhatsApp à l'ouverture du fil. Elles sont en place depuis
   l'ADR 0087 — quatre amorces, quatre commandes, vérifiées le 14/08.
2. **La réponse du bot**, dès son premier message.

**Le bot ne peut pas parler le premier.** Un message que l'entreprise initie
hors de la fenêtre de 24 h exige un gabarit approuvé, et nous n'en avons aucun
(CLAUDE.md, « tout ce qui exige des gabarits utilitaires attend le WABA »). Les
amorces ne sont donc pas un complément à un message d'accueil : elles **sont**
l'accueil avant le premier mot. Ce point se redit ici parce qu'il se reperd :
la demande « que le bot écrive un message quand quelqu'un ouvre la
conversation » est, telle quelle, irréalisable — et ce n'est pas un manque
d'implémentation.

## Le défaut — l'entonnoir fuyait encore, pour deux publics sur trois

L'ADR 0034 a fermé la fuite vendeuse : sans lien de boutique, la réponse
offrait « Vendre avec Catalog ». **Un seul bouton.** Les deux autres publics
restaient dehors :

- celle qui **attend sa commande** devait deviner le mot « suivi ». Le geste
  existait, marchait déjà sans boutique, et n'était annoncé nulle part ;
- celle qui **ne connaît pas le produit** n'avait rien à lire. La phrase
  d'accueil lui disait d'ouvrir le lien d'une boutique — un lien qu'elle n'a
  pas, et qu'aucun annuaire ne lui donnera.

## Décision

L'accueil sans boutique porte **trois** boutons :

```
Je suis Catalog. Ici, une vendeuse ouvre sa boutique en deux minutes,
et une acheteuse suit sa commande et vérifie son reçu.

Que puis-je faire pour vous ?

[ Vendre avec Catalog ]  [ Suivre ma commande ]  [ Comment ça marche ? ]
```

**Trois est le maximum de l'API.** Ce menu est donc complet par construction :
il ne peut pas s'allonger sans qu'on choisisse quoi retirer. C'est une
contrainte utile — elle force l'arbitrage au lieu de le reporter.

Quatre propriétés portent la décision :

**1. Le bouton ne crée pas un second chemin.** « Suivre ma commande » passe par
`messageStatut`, exactement comme le mot tapé. Un test compare les deux
réponses message par message : le bouton rend le geste **visible**, il ne le
duplique pas.

**2. L'explication repose les gestes.** « Comment ça marche ? » ne rend pas un
texte nu : elle rend le texte **et** les deux boutons d'action. Quelqu'un qui
vient de comprendre à quoi sert le produit est précisément celui qui va vouloir
agir ; le laisser chercher quoi taper serait perdre au dernier mètre.

**3. La copie tient les invariants, et deux tests la tiennent au mot.** C'est
le message qui s'adresse à une inconnue — l'endroit où les promesses du produit
se tiennent ou se perdent. Elle dit que l'argent va **directement** d'elle à la
vendeuse, que Catalog **n'encaisse rien** et ne prend **aucune commission**
(AGENTS.md §2), et que le reçu vérifiable est ce qui la distingue d'une capture
d'écran (§1).

**4. Elle ne promet aucun annuaire.** Il n'en existe pas, et par construction :
une boutique se découvre par un lien partagé. La copie le dit en toutes lettres
— « il n'y a pas d'annuaire ici » — plutôt que de laisser chercher un catalogue
général qui n'arrivera jamais. AGENTS.md §7.7 : on dit ce qui manque.

## Le pidgin recule d'une clé, et c'est voulu

`wes.aideAcheteuse` portait une traduction du message d'**avant** : une seule
issue, « ouvre le lien d'une boutique ». Le message en porte trois, et ses trois
libellés de boutons sont en repli français.

Garder l'ancienne phrase ferait annoncer **un** service par un texte pidgin
au-dessus de **trois** boutons français — pire qu'un repli franc. La réécrire
serait inventer une traduction, ce que l'ADR 0034 interdit tant qu'une
locutrice n'a pas relu. La clé retombe donc sur le français, avec la raison
écrite sur place ; le texte d'origine reste dans l'historique du dépôt.
`PIDGIN_RELU` ne bouge pas.

## Ce que le câblage a corrigé au passage

Le test des vingt caractères de WhatsApp énumérait treize libellés de boutons —
**`btnVendre` n'en faisait pas partie**, depuis l'ADR 0034. La troncature de
`boutons()` est silencieuse : un libellé trop long part amputé, sans erreur.
C'était le premier message qu'une inconnue reçoit. Les trois boutons de
l'accueil sont maintenant dans la liste.

## Ce qui reste ouvert, et n'est pas fait

**L'amorce « Voir une boutique » ne mène nulle part.** Aucune règle ne
reconnaît ces mots ; la personne reçoit l'accueil ci-dessus, qui est une
réponse honnête mais pas celle que l'amorce promettait. Et ce n'est pas un
oubli qu'on peut combler : sans annuaire, « voir une boutique » n'est pas un
geste que le produit rend.

La remplacer est une décision de copie sur un objet **déposé chez Meta**, qui
ne se change que par un nouveau dépôt sur le numéro. Elle appartient au porteur
du produit, pas à ce lot.
