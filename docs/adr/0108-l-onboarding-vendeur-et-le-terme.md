# ADR 0108 — l'onboarding vendeur, et le terme « vendeur/se »

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0034, 0103

## Deux décisions, prises le même soir, sur la même copie

Le porteur du produit, en test sur son téléphone : « l'explication du
*Comment ça marche* n'est pas très claire pour le vendeur — un onboarding très
clair qui ne crée pas le churn, adapté à tout type de vendeur. Utiliser le
terme *vendeur/se* plutôt. »

## 1. L'explication s'adressait à la mauvaise personne

Qui touche « Comment ça marche ? » depuis l'accueil froid ? Quelqu'un qui a
écrit au numéro **sans lien de boutique** — donc, presque toujours, une
prospect vendeur/se qui a entendu parler de Catalog. C'est l'entonnoir que
l'ADR 0034 a ouvert. Une acheteuse, elle, arrive par le lien d'une boutique et
ne voit jamais cet accueil.

La copie de l'ADR 0103 répondait depuis le siège de **l'acheteuse** :

> « L'argent va directement de vous à elle […] Pour commander, il vous faut le
> lien de sa boutique — elle vous l'envoie. Il n'y a pas d'annuaire ici. »

Trois défauts, et le troisième est celui qui coûte :

1. le « vous » désigne l'acheteuse, alors que le lecteur veut vendre ;
2. rien ne dit ce que le produit change **pour lui** ;
3. la dernière ligne est un **négatif** — un cul-de-sac au premier message,
   c'est-à-dire du churn à l'endroit exact où l'on n'a qu'une chance.

**La nouvelle copie répond aux quatre peurs qui font partir**, dans cet ordre :

| peur | réponse, en première position |
|---|---|
| « je vais devoir changer ma façon de vendre » | *Vous vendez déjà sur WhatsApp. Catalog ne change pas ça.* |
| « je ne vois pas ce que ça m'apporte » | trois bénéfices concrets — lien, paiement, reçu |
| « on va me prendre de l'argent » | l'argent arrive sur VOTRE Mobile Money ; aucune commission |
| « c'est compliqué » | le nom de la boutique et la ville. Deux minutes, rien à installer |

Elle se ferme sur un **geste**, pas sur un manque : « Vous attendez plutôt une
commande ? Touchez *Suivre ma commande* » — le bouton est déjà sous le message.
L'annuaire n'est plus **nié**, il n'est simplement pas promis ; un test le
vérifie par la négative.

Rien n'y suppose un type de commerce : ni vêtement, ni nourriture, ni service.

## 2. Le terme : « vendeur/se » dans la copie, « vendeuse » dans le code

Le produit s'est écrit au féminin — c'est son public d'abord visé. La **copie**
s'adresse désormais à quiconque vend : « le/la vendeur/se », « client/e »,
« payé/e », « prêt/e ». Vingt-sept phrases reprises, dans les trois fils.

> **Amendement du même soir, deuxième passe.** Le porteur du produit : « oui,
> enchaîne acheteuse ». Le mot a suivi — « l'acheteur/se » — et la passe a
> découvert que la première s'était arrêtée trop tôt : voir la section
> « Ce qui manquait à la première passe » plus bas.

**Les identifiants de code ne bougent pas** : le fil `"vendeuse"`, le module
`comptoir-vendeuse.ts`, `EtatVendeuse`, le pas `comptoir:cliente`. C'est la
règle d'AGENTS.md §1 pour `catalogue`, appliquée telle quelle — le nom commun
du code n'est pas la copie, et un renommage produirait un diff illisible pour
zéro gain lisible. Les ADR 0001 à 0107 gardent le mot : un ADR ne se réécrit
pas.

**Deux exceptions, mesurées et documentées** : les gabarits
`reversement_absent` (« vos clientes ») et `paiement_conteste`
(« L'acheteuse de la commande ») sont **approuvés par Meta**. Les corriger dans
le dépôt ne changerait pas ce que Meta envoie — il faudrait re-soumettre,
attendre, et risquer un refus. La copie du dépôt est un miroir de l'approuvé ;
la faire diverger la rendrait menteuse. Le mot bouge quand le gabarit est
re-soumis.

## Ce qui manquait à la première passe

La deuxième passe cherchait « acheteuse ». Elle a trouvé le mot — et, en
passant, **trente-huit phrases au féminin seul que la première n'avait jamais
regardées** : tout l'écran vendeur/se (« Espace vendeuse », « vos clientes »
huit fois, « Remise a la cliente »), toute la boutique publique (« Écrire à la
vendeuse », « Prevenir la vendeuse »), la politique de confidentialité, et les
libellés de reçu de `packages/contracts`.

La cause n'est pas l'inattention : **la garde tenait une liste de huit
fichiers du bot**, et une liste ne protège que ce qu'elle nomme. Les trente-huit
phrases étaient hors garde sans que rien ne le dise — et un écran ajouté demain
y aurait échappé pareillement. C'est le même défaut de forme que le constat
C-003 : un dispositif qui a l'air de couvrir, et qui couvre un huitième.

La garde **parcourt** désormais les arbres de copie entiers — `apps/api/src`,
`apps/seller/src`, `apps/shop/src`, `apps/site/src`, `packages/ui/src`,
`packages/contracts/src`, `packages/db/prisma`. Ce qui est ajouté est couvert
d'office. 2 089 phrases inspectées au lieu de 150.

Trois choses apprises en l'écrivant, et qui valent d'être notées :

- **Le texte JSX n'est pas entre guillemets.** `<p>La vendeuse…</p>` est un
  nœud. Sans un second extracteur (`>…<`), toute la boutique publique passait
  sous la garde en silence — la forme la plus coûteuse d'un test vert.
- **Un `//` cherché n'importe où mange la fin de `"https://…"`**, laisse un
  guillemet ouvert, apparie de travers avec le suivant et fabrique des phrases
  qui n'existent pas : neuf faux positifs, mesurés. Les deux motifs de
  commentaire sont ancrés en début de ligne.
- **Le doublet explicite est neutralisé avant la recherche.** « les vendeuses
  et vendeurs camerounais » est la forme la plus inclusive, pas une
  infraction ; une garde qui la rejette rejette ce qu'elle demande.

Quatre messages d'erreur de démarrage (`SMS_ENCRYPTION_KEY`,
`ChiffreurInerte`, `ConsoleSmsSender`, `BETTER_AUTH_SECRET`) ont été repris
aussi. Ils ne sont lus que par qui déploie — mais le mot y désigne quand même
une personne, et les exclure aurait demandé une liste d'exceptions plus longue
que la correction.

## La garde, parce qu'une décision de copie se défait toute seule

`copie-inclusive.test.ts` lit les sources et rougit si une phrase désigne la
personne au féminin seul. Sans elle, la prochaine phrase écrite reprendrait
« la vendeuse » — parce que c'est ce que les vingt-sept voisines disaient.

Elle distingue ce que la décision distingue : les **commentaires** sont du code
(le mot y raconte l'histoire du produit, et l'histoire ne se réécrit pas), les
**interpolations** aussi (`${etat.cliente}` est un nom de champ). Le premier
jet de la garde rougissait sur ses propres identifiants — corrigé avant de
livrer.

Un troisième test tient l'exception : si le gabarit approuvé cesse un jour de
porter « vos clientes », il tombe et rappelle de **retirer la dérogation** —
une exception qui ne protège plus rien devient un trou.

## Ce qui reste à faire, et qui n'est pas fait

- **`acheteuse` est traité** (amendement du 14/08, seconde passe). Le mot était
  annoncé hors garde ici ; il y est entré le soir même, avec les trente-huit
  phrases que la liste fermée cachait.
- **Les gabarits Meta restent au féminin**, et c'est le seul reste assumé. Le
  mot bouge à la re-soumission, pas avant ; un troisième test tombe le jour où
  l'exception ne protège plus rien.
- **L'anglais n'a pas eu à bouger** : `seller` et `buyer` sont déjà neutres.
- **Le pidgin reste fermé** (`PIDGIN_RELU = false`) : ses clés retombent sur
  le français, donc elles héritent du terme sans relecture — ce qui est le
  comportement voulu de l'ADR 0034.
