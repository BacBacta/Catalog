# ADR 0107 — le registre des commandes

Date : 14/08/2026
Statut : accepté
Prolonge : ADR 0105 — c'en est la moitié « retrouver »

## Le principe

**La notification informe, le registre retrouve.** Le récapitulatif d'absence
(ADR 0105) a réglé l'avalanche ; restait le « je ne me retrouve pas » : aucune
surface du fil ne listait les commandes en cours. La vendeuse remontait sa
conversation à la main, parmi ses fils d'achat et ses collages de SMS.

## Décision

Le mot **« commandes »** (et `/commandes` au menu du numéro, la barre retirée
par `motDeGeste` — ADR 0104) rend une **liste** : les commandes ouvertes
(`balanceXaf > 0`, non annulées), la plus récente en tête, une ligne par
commande — référence, reste à encaisser, étape. **Toucher une ligne ouvre le
détail** : articles, montants, état de la preuve, destination, numéro à
appeler, et le geste suivant.

Quatre règles portent la conception :

**1. La machine demande, le service charge.** La liste se construit du
contexte déjà chargé (`commandesOuvertes`, enrichi de l'étape) ; le détail
passe par un effet (`detail_commande`) — les articles et la livraison se
lisent à la demande, jamais stockés dans l'état de conversation. Le `WHERE`
du service porte `sellerId` : un identifiant relu d'un message WhatsApp ne
peut pas ouvrir la commande d'une autre.

**2. Le débordement est dit, jamais avalé** (règle de l'ADR 0105) : neuf
lignes, puis « Voir tout — N de plus, dans votre espace ». La borne de dix
lignes est celle du transport.

**3. Le détail dit l'état ET le geste suivant** — jamais un fait sans la
suite (leçon du banc du 11/08, « le flow est mort côté vendeur ») :
« livrée CT-… » tant que ce n'est pas remis, l'appel à l'acheteuse si c'est
contesté, l'encaissement s'il ne reste que lui. Le dépôt déclaré à la main
reste marqué **non tracé** (AGENTS.md §2) ; un paiement contesté s'affiche
**gelé** avec son ⚠️.

**4. La copie est liée au geste.** Le récapitulatif d'absence promet
désormais « écrivez *commandes* » — la promesse que l'ADR 0105 s'était
interdite tant que le registre n'existait pas. Le test qui l'interdisait
s'est inversé : il exige maintenant la promesse **et** vérifie dans le même
souffle que `demandeRegistre` reconnaît le mot. Si le geste casse, la copie
rougit avec lui.

## Ce qui reste connu et non fait

- Le registre liste les commandes **ouvertes** ; l'historique complet reste
  l'affaire de l'espace vendeuse, et la ligne « Voir tout » y mène.
- `/commandes` porte le menu à **cinq** commandes ; la borne de Meta n'est pas
  documentée de façon fiable — si le dépôt la refuse, `accueil-poser` échoue
  en le disant, et rien d'autre ne casse.
- Aucune action d'écriture depuis le détail (pas de bouton « marquer
  livrée ») : le geste reste le mot « livrée CT-… », déjà en place, un seul
  chemin d'écriture.
