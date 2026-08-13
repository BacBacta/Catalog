# 0086 — Le fil vendeuse cesse de noyer : deux messages, jamais sept

- **Statut** : accepté
- **Date** : 13/08/2026
- **Révise** : l'ADR 0034 (messages d'ouverture), l'ADR 0037 (carte-vitrine à
  la première publication) et l'ADR 0061 rang 3a (pack statut à chaque
  publication) — sur le MOMENT de l'envoi, jamais sur le contenu.

## Ce que le banc a montré, en deux captures

À l'ouverture d'une boutique, **cinq messages d'affilée** : le lien de
boutique, puis le reversement et le parrainage, puis « Ajoutons votre
premier article ? », puis le formulaire, puis la question du nom. Le
porteur du produit : « une série de liens, de messages apparaissent, ce
qui noie l'essentiel, cela rend touffu et confus le vendeur ».

À la publication d'un article, **jusqu'à sept** : la confirmation, la
carte-vitrine, les trois messages du pack statut, le mode d'emploi. « Le
vendeur ne sait plus quoi faire, certains onglets sont noyés dans la tonne
de messages. »

Le diagnostic n'est pas que ces messages sont mauvais — ils sont bons, un
par un. C'est qu'ils arrivent **tous au même instant**, et que WhatsApp
n'a ni épinglage ni hiérarchie : le septième a le même poids que le
premier, et les boutons du premier ont déjà défilé hors de l'écran.

## Décision 1 — l'ouverture tient en deux messages

Un seul message porte ce dont la vendeuse a besoin **dans la minute** :
son lien, la phrase qui dit à quoi il sert, et deux boutons — « Ajouter un
article », « Plus tard ». Le formulaire suit, quand il est configuré. Rien
d'autre.

Le reste n'est pas perdu, il est **servi là où il sert** :

- le **reversement** a déjà sa relance à ~20 h (ADR 0035), il reparaît dans
  la notification de première commande — au moment où il coûte — et il vit
  dans le menu « ma boutique » ;
- le **parrainage** vit dans le menu « ma boutique ». Personne ne parraine
  une consœur dans les dix secondes qui suivent l'ouverture ;
- la **question du nom d'article** ne double plus le formulaire ; sans
  formulaire configuré, elle reste le seul chemin et demeure.

## Décision 2 — la publication tient en un message, deux au premier article

La confirmation part **seule** (et d'abord — ADR 0085). Au premier article
s'ajoute le mode d'emploi, parce que c'est l'instant où « que se passe-t-il
maintenant ? » se pose.

La carte-vitrine et le pack statut **ne partent plus tout seuls**. Ils sont
mis à portée : le bouton « Ma carte » du message de publication, et le mot
« ma carte ». Poster en Statut est un geste qu'on fait quand on a décidé de
le faire — pas dans la seconde où l'on ajoute un article.

**Ce que « Ma carte » sert dépend de la boutique** : avec un seul article,
le pack statut (l'image de l'article, et la légende prête à coller sous
elle) dit mieux ce qu'il y a à poster ; à partir de deux, la vitrine
reprend la main — elle montre la boutique, pas un objet.

## Ce qui reste à mesurer, et qu'on ne suppose pas

Meta documente des **Flows multi-écrans sans endpoint** (`navigate` puis
`complete`, les données s'accumulent et reviennent ensemble) et les
composants `Image` et `RichText` : de quoi remplacer une salve de questions
par un formulaire unique. C'est la voie pour l'ouverture « boutique +
premier article » en un seul écran enchaîné, et elle est ouverte.

En revanche le bouton **`cta_url`** — qui remplacerait les URL brutes par
un bouton — est annoncé dans les guides et **absent de la référence des
messages**. Il n'est donc utilisé nulle part ici : conformément à
AGENTS.md §7.7, une forme non confirmée se mesure avant de s'employer, elle
ne se suppose pas. La réduction ci-dessus n'en dépend pas.
