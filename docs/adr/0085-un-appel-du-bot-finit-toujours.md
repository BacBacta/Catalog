# 0085 — Un appel du bot finit toujours, et l'essentiel part en premier

- **Statut** : accepté
- **Date** : 13/08/2026
- **Complète** : l'ADR 0040 (idempotence des entrants) et l'ADR 0049 (accusé
  de lecture) — même famille : ce que le fil promet, le fil doit le tenir.

## La panne la plus silencieuse possible

Banc du 13/08/2026. Une vendeuse publie son **deuxième** article par le
formulaire. WhatsApp affiche « Réponse envoyée ✓✓ ». Puis plus rien.

La sonde a tranché : la boutique porte **deux articles en base**. Le second
a donc été créé. Aucune erreur dans les journaux — ni « livraison non
traitée », ni rien. Le bot n'a pas levé : **il n'a jamais fini**.

Deux défauts s'additionnaient, et chacun suffisait :

1. **Aucun appel sortant n'avait de délai d'attente.** `fetch` sans signal
   n'expire pas. Une connexion qui reste ouverte sans répondre — un CDN
   froid, un relais qui avale, un objet qui ne vient pas — suspend la
   promesse pour toujours. Et comme la route entrante attend la fin du
   traitement avant de rendre son 200, rien ne tombe, rien ne s'écrit, la
   conversation s'arrête net.
2. **Tout était composé avant que rien ne parte.** `publierArticleDepuisFil`
   assemblait la confirmation, puis la carte-vitrine, puis le pack statut
   (rendu, ré-encodage, trois téléversements, vérification d'URL), puis le
   mode d'emploi — et ne rendait la liste qu'ensuite. Un blocage dans la
   décoration emportait donc **la seule phrase qui comptait**, déjà écrite.

## Décision 1 — un appel du bot échoue, ou il finit

`fetchBorne` enveloppe tout `fetch` sortant du bot d'un délai de **quinze
secondes** : envoi WhatsApp, lecture de média, téléchargement CDN,
déclenchement de reconstruction. Le signal de l'appelant est préservé quand
il y en a un — les deux s'additionnent, le premier qui parle gagne.

Un dépassement devient une **erreur ordinaire**, que les appelants savent
déjà traiter : un média illisible publie l'article sans photo, un envoi
refusé se journalise, une reconstruction ratée se retente à la publication
suivante. Le délai ne borne pas la performance, il borne l'**infini** : un
réseau camerounais lent doit passer, une connexion morte non.

## Décision 2 — l'essentiel part d'abord, la décoration suit

La confirmation de publication part **seule et tout de suite**, avant que
la carte, le pack statut et le mode d'emploi ne soient seulement composés.
Ils sont de la décoration : leur lenteur, leur échec, leur absence ne
peuvent plus faire taire le message qui dit « votre article est en ligne ».

C'est la règle générale, pas un correctif local : **ce qui informe passe
avant ce qui embellit**, partout où le fil compose plusieurs messages.

## Ce qui est vérifié

- un `fetch` qui ne répond jamais rejette au lieu d'attendre, et le signal
  de l'appelant reste honoré ;
- un **stockage qui ne répond jamais** ne fait plus taire la confirmation :
  le test rejoue exactement la panne du 13/08, et exige que le nom de
  l'article sorte quand même.
