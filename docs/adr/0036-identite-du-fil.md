# 0036 — L'identité du fil : contre-signer et noter sans quitter WhatsApp

Date : 02/08/2026 · Statut : accepté · Complète : 0021, 0027, 0034, 0035

## Contexte

Le lot 10 a donné à l'acheteuse un **jeton de suivi** : un secret envoyé dans
son fil, qui autorise la contre-signature (contrôle n° 7) et le dépôt d'avis.
Le lot 12 a bâti la réputation dessus. Le P0 de l'ADR 0035 vient de réparer le
maillon manquant — une preuve acceptée fait enfin avancer la commande et émet
le reçu.

Il reste que **les deux derniers gestes éjectent hors de WhatsApp**. Pour
confirmer qu'elle a bien payé, puis pour noter, l'acheteuse doit ouvrir un lien
et charger une page web. Deux conséquences, mesurées ailleurs dans ce dossier :
certains forfaits camerounais font échouer les liens externes, et chaque sortie
du fil coûte une part des personnes qui ne reviennent pas. Or ces deux gestes
sont ceux qui **ferment la chaîne de valeur du produit** : sans
contre-signature, la preuve reste à une voix ; sans avis, la réputation ne se
construit pas.

La question posée est donc : peut-on autoriser ces deux gestes sur la seule foi
de **qui écrit dans le fil** ?

## Décision 1 — le fil porte déjà le jeton, donc l'identité du fil ne crée aucune exposition

C'est l'argument qui tranche, et il faut le dire précisément.

Le message de confirmation de commande **contient le lien de suivi**, jeton
compris, et il a été livré dans cette conversation. Quiconque peut lire le fil
possède donc **déjà** ce secret : il lui suffit de faire défiler. Autoriser un
geste parce qu'il vient de ce fil est par conséquent **strictement équivalent**
à l'autoriser parce que la personne a rouvert le lien qui s'y trouve — au
frottement près.

Le modèle de menace est inchangé sur toute la ligne. Un téléphone volé donne
accès au fil, donc au lien : la contre-signature était déjà à portée. Une
vendeuse qui manipule le téléphone de son acheteuse pouvait déjà ouvrir le lien
et se contre-signer elle-même. **Aucun scénario nouveau n'apparaît**, et c'est
la seule raison pour laquelle cette décision est acceptable : elle retire une
friction, elle n'ouvre pas une porte.

Le `wa_id` reste par ailleurs attesté par Meta, comme aux ADR 0027 et 0034 :
personne ne peut se présenter comme un autre numéro.

## Décision 2 — deux gestes, et deux seulement

L'identité du fil autorise :

1. **la contre-signature** de la dernière commande du fil (contrôle n° 7) ;
2. **le dépôt et l'enrichissement d'un avis** sur cette même commande ;
3. **la contestation** — le pendant honnête de la contre-signature, sans lequel
   on n'offrirait que le « oui ».

Elle n'autorise **rien d'autre**. Jamais un paiement, jamais une modification
de commande, jamais quoi que ce soit qui touche au numéro de reversement — ce
champ garde son OTP propre (AGENTS.md §2, ADR 0034). La liste est fermée, et
l'ajout d'un geste exigera de rouvrir cet ADR.

## Décision 3 — la portée est la DERNIÈRE commande du fil, jamais une référence tapée

L'autorisation vient de `BotConversation.derniereCommandeId` : la commande
**créée depuis cette conversation**. Une référence écrite à la main
(« contresigner CT-522801 ») n'autorise rien — sinon il suffirait d'avoir vu un
reçu, ou d'énumérer des références, pour valider le paiement d'autrui. C'est
exactement le défaut que l'ADR 0021 interdit : « ne jamais faire ouvrir le
suivi par la référence ou par le code ».

**Le jeton, lui, ne se re-projette jamais.** Le garde du lot 10 tient : aucune
requête de ce chemin ne sélectionne `buyer_token`. On agit sur la commande, on
n'affiche pas son secret.

## Décision 4 — les mêmes machines décident, la route web reste la référence

Aucune règle n'est réécrite pour le fil :

- la contre-signature et la contestation passent par `appliquerEvenement` du
  lot 7 — donc la contre-signature reste **impossible sans preuve préalable**
  (elle renforce une preuve, elle ne la crée pas), et une transition arrière
  est journalisée puis ignorée ;
- le droit de déposer un avis passe par `droitAuDepot` du lot 12 — donc un
  dépôt direct non tracé donne un avis **publié mais non vérifié**, et un avis
  ne se dépose qu'après livraison ;
- l'unicité d'un avis par commande reste tranchée par la contrainte `UNIQUE` de
  la base, pas par un `if`.

Le fil est une **seconde porte sur les mêmes serrures**, pas un second jeu de
serrures.

## Décision 5 — la note est enregistrée avant le commentaire

Le dépôt se fait en deux temps : la note (une liste de 1 à 5), puis un mot
facultatif. **La note s'écrit dès qu'elle est donnée** ; le mot vient ensuite
enrichir l'avis existant. L'inverse — attendre le texte pour tout écrire —
perdrait l'avis de toutes celles qui ne répondent pas à la seconde question,
c'est-à-dire la majorité.

`Review` n'est pas un journal d'audit : compléter son corps est une mise à
jour ordinaire, et l'unicité par commande la rend sans ambiguïté.

## Conséquences

- `BotNotification` gagne une colonne `boutons` (expand) : une notification mise
  en attente hors fenêtre doit pouvoir porter ses boutons jusqu'à sa remise,
  sinon la contre-signature disparaîtrait pour toutes les acheteuses inactives.
- Les mots-clés « confirmer » et « avis » marchent aussi en texte : un bouton
  périmé ou une liste refermée ne doit jamais être un cul-de-sac (ADR 0032).
- L'état de conversation gagne `avis_mot` — le seul état d'après-achat ; il
  périme comme les autres (24 h) et ne détient jamais que la référence.
- La page web de suivi **reste** : elle sert l'acheteuse qui n'a pas commandé
  depuis le fil (lien partagé, commande passée par une amie), et elle reste la
  preuve publiquement vérifiable du reçu.
