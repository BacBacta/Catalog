# ADR 0089 — le silence cesse d'être une issue possible

Date : 13/08/2026
Statut : accepté
Prolonge : ADR 0085 (un appel du bot finit toujours)

## Contexte

Trois défauts au banc du 13/08, en une seule session de test. Le porteur du
produit : « l'idée est de passer vraiment du stade de bot à une réelle
application, et l'approche que nous avons est mauvaise ».

Il a raison, et pas seulement sur la forme. Les trois défauts partagent une
seule cause : **le système échoue sans le dire**.

1. la photo du formulaire disparaît, et le bot répond « Sans photo pour
   l'instant » — la même phrase qu'à qui n'a rien envoyé ;
2. le fil s'ouvre sur du vide ;
3. le fil se tait après la carte-vitrine.

L'audit (`docs/audit-parcours-2026-08.md`) a cherché le motif plutôt que les
trois cas, et il en a trouvé **quatre autres** que le banc n'avait pas encore
rencontrés.

## Décision 1 — un appel sortant finit toujours, quelle que soit la bibliothèque

L'ADR 0085 avait borné les `fetch` du **bot**. Il en restait quatre :

- **les trois canaux du code de connexion** (`sms-mboa`, `sms-orange`,
  `sms-whatsapp`) appelaient `fetch` nu. C'est la porte d'entrée du produit :
  une vendeuse qui ne reçoit pas son code ne peut rien faire d'autre ;
- **le client de stockage** n'avait ni délai ni plafond de tentatives. Le SDK
  AWS v3 attend **indéfiniment** par défaut — `requestTimeout` vaut zéro.

Le second est la cause du défaut 3. La carte-vitrine fait trois `put`
d'affilée ; un stockage qui accepte la connexion puis se tait suspendait la
réponse entière, sans erreur ni trace.

**La leçon corrigée** : « borner les appels du bot » était trop étroit. Ce
n'est pas une propriété du bot, c'est une propriété du **processus**. Un test
de garde (`apps/api/src/__tests__/appels-bornes.test.ts`) lit désormais les
sources et refuse un appel non borné, quel que soit son auteur — avec des
dispenses nommées, chacune portant sa raison écrite.

## Décision 2 — l'essentiel part d'abord, partout où il y a décoration

`carteVitrine` était appelé sans filet, et tout ce qui précédait n'était
envoyé qu'après. La règle de l'ADR 0085 avait été appliquée à la publication
d'article et oubliée ici.

Deux verrous, et il en faut deux :

- le **délai** empêche l'attente infinie ;
- le **filet** empêche l'échec d'emporter le reste.

Un délai sans filet transforme un gel en exception qui perd quand même les
messages déjà composés. Un filet sans délai n'attrape rien, puisque rien ne
lève.

Et l'échec **dit quelque chose**. Une carte muette laisserait la vendeuse
devant un bouton sans effet — ce qui est exactement le défaut qu'on ferme.

## Décision 3 — « je n'ai pas pu » n'est pas « il n'y en avait pas »

La chaîne de la photo traverse un CDN, un déchiffrement authentifié à huit
portes et un ré-encodage. **Vingt-trois `return null` silencieux** au total,
aucun journalisé.

On ne peut pas garantir qu'elle n'échouera jamais. On peut garantir qu'elle
le **dira** : `creerArticleDepuisFil` rend `photoPerdue`, et
`messageArticlePublie` a trois états au lieu de deux.

Le message d'échec **donne le geste suivant** — « renvoyez-la simplement ici »
— et rappelle que l'article existe. Une phrase qui constate sans dire quoi
faire laisse aussi bloquée que le silence.

> **La règle générale** : deux situations opposées ne partagent jamais une
> phrase. Si le même texte sert au cas normal et au cas d'échec, la personne
> ne peut pas savoir laquelle elle vit — et nous non plus, plus tard, en
> lisant la trace.

## Ce qui n'est PAS décidé ici

**Le défaut 2 — le fil muet à l'ouverture — reste ouvert.** Les amorces sont
posées, vérifié en lecture le 13/08 ; elles ne s'affichent pas au banc. Trois
hypothèses, aucune mesurée. Le §7.7 d'`AGENTS.md` interdit d'en choisir une.

Ce qui est **déjà acquis** sans mesure : quelle que soit la réponse de Meta,
une conversation qui s'ouvre sur du vide est un défaut produit. Le palliatif
— un message d'accueil au premier contact d'un numéro inconnu — ne dépend
d'aucune capacité Meta et ne coûte rien. Il est la première tâche de la passe
suivante.

**Les autres effets qui composent une décoration** (`poser_chaine`,
`creer_vente`, le pack statut) n'ont pas été vérifiés un par un. La carte
l'est. Dire « tous les chemins sont sûrs » serait exactement l'invention que
le prompt interdit.
