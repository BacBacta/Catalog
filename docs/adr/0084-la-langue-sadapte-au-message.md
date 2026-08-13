# 0084 — La langue s'adapte au message, le mot-clé demeure

- **Statut** : accepté
- **Date** : 13/08/2026
- **Révise** : l'ADR 0033 sur le SEUL mécanisme de changement de langue
  (mot-clé exact) ; ne rouvre ni la liste des langues servies ni le
  verrou pidgin (ADR 0034).

## La décision du porteur, au banc du 12/08

« Pour la langue c'est muet. L'utilisateur doit deviner. Cela doit être
automatique : si l'utilisateur écrit en français, la langue s'adapte, s'il
switch en anglais ça s'adapte. » Une acheteuse de Buea qui écrit « How
much? » recevait du français, et rien ne lui disait que « english » était
le sésame. Un mécanisme qui exige de connaître le mot-clé pour découvrir
qu'on peut changer de langue ne sert que ceux qui n'en ont pas besoin.

## La décision

**Une détection passive, par message, sur signaux nets.** Deux listes
fermées de mots du commerce quotidien (`langueDetectee`), comptés à la
frontière de mot ; la langue qui en compte STRICTEMENT plus gagne, toute
égalité — zéro compris — laisse la conversation où elle est. La réponse au
message détecté part déjà dans la nouvelle langue, qui est persistée par le
canal existant (`Reaction.langue`) — exactement comme le mot-clé.

Trois garde-fous, tous testés :

- **jamais dans les états où le texte libre est du CONTENU** (détails de
  livraison, ville, mot d'avis) : « Bonapriso, near the pharmacy » est une
  adresse, pas un changement de langue — même garde que pour les slugs
  (ADR 0050) ;
- **jamais sur un signal ambigu** : « 2 », « ok », un nom propre, un
  message vide, ou un signal de chaque côté ne bougent rien ;
- **jamais le pidgin** : il n'est pas servi (`PIDGIN_RELU`, ADR 0034), et
  un signal qu'on ne peut pas honorer serait une promesse. « How much e
  dey » reçoit l'anglais — la langue la plus proche que l'on sait servir.

Le mot-clé explicite (« english », « français ») garde sa primauté et son
annonce (`langueChangee`) : c'est une demande sur la conversation, elle
mérite un accusé. La détection, elle, est silencieuse — s'adapter n'est pas
un événement.

## Ce qu'on ne fait pas

Pas d'inférence statistique, pas de bibliothèque de détection : des listes
qu'on relit en une minute, dans le domaine pur, testées mot à mot. Le jour
où un mot trahit (un prénom, un nom de quartier anglophone), on le retire
de la liste — on ne règle pas un seuil.
