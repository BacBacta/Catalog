# 0076 — La distribution : sa chaîne, et la carte qu'aucune concurrente ne peut poster

Date : 2026-08-12
Statut : accepté
Met en œuvre : 0061 (deux comptoirs, un moteur), rang 3b et 3c
Prolonge : 0037 (la carte-vitrine), 0075

## Contexte

Le rang 3 de l'ADR 0061 est gouverné par une contrainte de plateforme, pas par
un choix : **Catalog fabrique, la vendeuse poste.** Ni la Cloud API ni aucun
outil légitime ne publie un Statut ou n'alimente une chaîne à sa place. Le
rang 3a (pack statut) a livré la première moitié. Voici les deux autres.

## a) Sa chaîne

### Ce qu'on ajoute, et ce qu'on n'ajoute pas

Une chaîne WhatsApp diffuse à des abonnés qui ont **choisi** de suivre. C'est
l'audience qu'une vendeuse construit une fois et garde — contrairement au
Statut, qui disparaît en 24 h et ne touche que son carnet d'adresses.

Ce qu'on ajoute est plus petit qu'il n'y paraît : on **range** son lien, on le
montre sur sa page sous « Suivre la boutique », et on lui donne des munitions
marquées `chaine`. On ne crée aucune chaîne, on n'y publie rien.

### Ce qu'on ne peut PAS vérifier, et qui se dit

Que la chaîne existe, qu'elle soit à elle, qu'elle soit active : rien de cela
n'est vérifiable sans API. On valide donc **la forme du lien, et rien d'autre**.
Une vendeuse qui colle le lien d'une chaîne qui n'est pas la sienne obtiendra
une page qui pointe ailleurs — c'est son lien, sur sa page, sous sa
responsabilité, exactement comme son numéro WhatsApp.

### La canonisation, qui n'est pas cosmétique

Deux vendeuses collant la même chaîne — l'une depuis le partage mobile, l'autre
depuis le web avec ses paramètres de suivi — doivent produire **la même chaîne
de caractères**. Sinon la page publique et la carte afficheraient deux liens
pour une seule chaîne. `lireLienChaine` ramène tout à
`https://whatsapp.com/channel/<id>`.

Les paramètres de suivi sont **retirés** : ils viennent du partage, ils
n'appartiennent pas au lien, et les republier ferait porter à la boutique les
traces d'un tiers.

### On n'invente pas de format plus strict

Le motif accepte un identifiant non vide sans séparateur de chemin. Plus serré
rejetterait un lien parfaitement valide sans qu'une vendeuse puisse comprendre
pourquoi — alors qu'un lien accepté à tort produit une page qui pointe
ailleurs, ce qui **se voit et se corrige**. L'asymétrie des coûts décide.

### Pas de machine à états, et c'est délibéré

« Ma chaîne » rappelle le lien rangé et invite à le coller ; le message suivant
qui **contient** un lien de chaîne le range. Un lien se reconnaît à sa forme :
une vendeuse qui change d'avis entre les deux messages n'est bloquée nulle part,
et il n'y a pas d'état à expirer. Le geste inverse — « retirer » — existe
toujours.

## b) La carte d'avis vérifié — la boucle qui se referme

### Pourquoi cette carte vaut plus que les autres

N'importe quelle vendeuse peut poster « mes clientes sont contentes ». **Aucune
ne peut le prouver.** Celle-ci le peut : l'avis affiché est adossé à un paiement
prouvé par le SMS de l'opérateur, passé aux sept contrôles. C'est le seul objet
du produit qu'une concurrente ne peut pas fabriquer.

### La règle qui ne se négocie pas

**Jamais de carte pour un avis non vérifié.** Un avis non vérifié existe et il
est honnête — le dépôt direct non tracé le produit (AGENTS.md §2). Mais en faire
une carte qui dit « vérifié par paiement » serait exactement la réputation
achetable que le produit refuse. La condition vit à un seul endroit, au moment
de l'envoi, et la fonction de composition ne sait rien composer d'autre.

### Le compteur se relit APRÈS

Il compte donc l'avis qui vient d'arriver. Le lire avant afficherait un nombre
en retard d'une unité sur la carte que la vendeuse va justement poster.

### Une troncature invisible, trouvée par un test

Le mot de l'acheteuse était coupé **deux fois** : à 140 caractères avec ellipse,
puis en trois lignes d'environ 34 — et l'ellipse tombait hors du bloc. Une
acheteuse lisait une phrase tronquée **qui se donnait pour entière** : le mot de
quelqu'un d'autre, amputé sans le dire. C'était la seule troncature du produit
dont personne n'aurait rien su. L'ellipse se pose désormais sur la dernière
ligne conservée.

## Conséquences

- Une colonne additive et nullable, `seller.chaine_url` — phase *expand*
  (AGENTS.md §6). `NULL` est l'état normal : une vendeuse n'a pas forcément de
  chaîne, et n'en aura peut-être jamais.
- La page publique gagne « Suivre la boutique », **absent** quand il n'y a pas
  de chaîne : on ne montre pas un bouton qui ne mène nulle part. Le lien sortant
  porte `noopener noreferrer` — le second parce que le jeton de suivi ne voyage
  jamais en référent (ADR 0021).
- Poser ou retirer la chaîne **reconstruit la page**, puisque « Suivre la
  boutique » en dépend et que la boutique est statique (ADR 0065). Le
  regroupement absorbe la rafale d'une vendeuse qui se ravise.
- La carte d'avis emprunte la chaîne d'images de la carte-vitrine, calibrage
  compris (ADR 0059) : le QR doit rester scannable, et deux pipelines auraient
  fini par diverger là-dessus.
- Les deux munitions portent un canal marqué — `chaine` — donc les commandes
  qui en naissent se comptent à part (vocabulaire du rang 0).

## Ce qui reste ouvert

Le rang 3 est clos. **Le pidgin reste écrit et non servi** (ADR 0034) : les
copies nouvelles de ce lot sont en français, comme tout le fil vendeuse
(ADR 0033), et la carte d'avis l'est aussi. Rien n'y change tant qu'une
locutrice n'a pas relu.
