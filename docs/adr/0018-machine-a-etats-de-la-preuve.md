# 0018 — La machine à états de la preuve : une transition ajoutée, et pourquoi

- Statut : accepté
- Date : 2026-07-30
- Concerne le lot 7 (`apps/api/src/domain`)
- N'ajoute aucune dépendance de production

## Contexte

Le lot 7 modélise le domaine métier sans réseau ni base : les trois modes de
paiement, la machine à états de la **preuve**, l'expiration à 48 h, et les
montants non conformes.

Le blueprint énumère quatre transitions :

```
attendu → déclaré_non_trace
attendu → prouve
prouve  → contresigne
tout état → conteste
```

Trois décisions ont été prises au-delà de cette liste. Elles sont écrites ici
parce qu'aucune n'est déductible du texte.

## Décision 1 — `declare_non_trace → prouve` est permise

La liste littérale ne la contient pas. Elle en découle pourtant de la règle qui
gouverne la machine — « un état ne recule jamais » implique un ordre de solidité —
et son absence produirait un défaut produit net.

Le scénario : une vendeuse reçoit l'argent, ne trouve pas son SMS, déclare le
dépôt à la main pour que la commande avance. Une heure plus tard elle retrouve le
message. Si la transition est interdite, **elle est enfermée dans
`declare_non_trace` pour toujours** — donc sans reçu et sans avis vérifié, alors
qu'elle détient la preuve.

AGENTS.md dit du dépôt non prouvé qu'il « se déclare manuellement, fait avancer
la commande, et reste marqué non tracé ». Il ne dit pas que c'est un cul-de-sac.
La machine est donc construite sur un **rang de solidité** :

| rang | état | ce qu'il vaut |
|---|---|---|
| 0 | `attendu` | la commande existe, rien n'est apporté |
| 1 | `declare_non_trace` | la vendeuse affirme avoir reçu, sans SMS |
| 2 | `prouve` | SMS analysé, sept contrôles passés |
| 3 | `contresigne` | l'acheteuse a confirmé. Deux voix, le plus fort |

Toute transition vers un rang strictement supérieur est permise ; toute autre est
journalisée puis ignorée. Les quatre transitions du blueprint sont exactement les
cas particuliers de cette règle, plus celle-ci.

`conteste` n'a **pas de rang**. Ce n'est pas un degré de preuve mais un litige :
il est atteignable depuis n'importe quel état, et rien n'en sort.

## Décision 2 — la machine consomme des ÉVÉNEMENTS, pas des états cibles

`appliquerEvenement(etat, evenement, now)` prend un fait — « la vendeuse a
déclaré », « un SMS a passé les contrôles » — et non l'état voulu. Cela ferme un
chemin : un appelant ne peut pas demander `prouve` sans fournir l'événement qui le
justifie, et donc sans fournir un identifiant d'opérateur.

C'est ce qui rend trois interdits d'AGENTS.md structurels plutôt que
conventionnels :

- **jamais « payé et prouvé » sans identifiant d'opérateur.** L'événement
  `sms_analyse` l'exige dans son type, et un identifiant vide est refusé avec
  `identifiant_operateur_absent` ;
- **jamais `prouve` sur le seul SMS d'émission de l'acheteuse.** L'événement
  porte le **sens** du message ; un `sortant` est refusé pour
  `preuve_insuffisante`. Seul le SMS reçu par la vendeuse fait autorité — c'est
  elle qui a l'argent ;
- **`accepte_sous_reserve` ne prouve pas.** C'est ce que produit un motif marqué
  « à confirmer », en particulier le SMS Orange de réception dont la capture
  disponible est tronquée (AGENTS.md §10). Refusé pour la même raison.

L'ordre des contrôles est lui aussi une décision : le verdict des sept contrôles
passe **avant** la forme de l'identifiant. Annoncer « identifiant absent » sur un
SMS que les contrôles ont rejeté enverrait la vendeuse chercher le mauvais
problème. Un test le fixe.

## Décision 3 — `contresigne` reste contestable, et `conteste` est terminal

Deux choix opposés dans le même paragraphe, et c'est voulu.

`contresigne` est l'état le plus fort du système, et il doit rester attaquable :
deux voix qui s'accordent peuvent être deux voix de la même personne. Une preuve
à deux voix définitive serait une collusion à l'abri.

`conteste`, en revanche, ne mène nulle part. Sortir d'un désaccord entre deux
personnes est une action humaine — support, médiation — et le domaine ne doit pas
pouvoir le faire tout seul. Toute avancée depuis `conteste` est refusée pour
`litige_ouvert`. C'est un choix de v1 : le jour où une procédure de résolution
existera, elle demandera son propre ADR.

## Le sur-paiement ne va pas dans `amountPaidXaf`

Le blueprint demande que le sous-paiement et le sur-paiement produisent « un état
partiel documenté, jamais un rejet silencieux ». Le sous-paiement est direct : la
commande avance, le solde reste ouvert.

Le sur-paiement l'est moins. L'invariant de base est
`amount_paid_xaf + balance_xaf = total_xaf`, garanti par une contrainte SQL
(lot 3). Ranger un excédent dans `amountPaidXaf` la violerait — et surtout ce
serait **faux** : on doit de la monnaie, l'acheteuse n'a pas acheté davantage. Le
surplus sort donc dans un champ distinct, `aRendreXaf`, et l'invariant tient à
chaque appel.

`appliquerVersement` **refuse** de travailler sur un état déjà incohérent plutôt
que de le corriger en silence : corriger masquerait le vrai défaut.

## La tolérance de montant est à zéro, et c'est une question ouverte

`TOLERANCE_XAF_DEFAUT = 0` n'est pas un défaut paresseux. Les frais hors réseau
(2,22 % mesuré) sont à la charge de l'émetteur, donc le montant reçu devrait être
exact — mais nous n'avons pas observé assez de versements réels pour savoir si des
écarts de quelques francs apparaissent (arrondis d'opérateur, promotions).

Tant que ce n'est pas mesuré, **on ne fabrique pas une tolérance plausible** : un
écart d'un franc est classé comme un écart, et c'est l'interface qui décidera s'il
vaut la peine d'être montré. La tolérance est un paramètre, pas une constante, pour
que la réponse puisse arriver du terrain.

## Les rappels comptent depuis la création — lecture à confirmer

« Une commande non payée expire à 48 h, avec rappel à 2 h et 24 h. » Deux lectures
sont possibles : 2 h et 24 h **écoulées depuis la création**, ou 2 h et 24 h
**avant l'échéance**.

Retenu : depuis la création. La séquence 2 h → 24 h → 48 h se lit ainsi, et 24 h
après la création tombe de toute façon à 24 h de l'échéance — seul le premier
rappel diffère (2 h ou 46 h). Un rappel à 46 h arriverait deux heures avant la
mort de la commande, ce qui laisse peu de temps pour agir. **À confirmer avec une
vendeuse** ; la constante est nommée et isolée pour que la correction soit d'une
ligne.

Trois propriétés des rappels, chacune testée :

1. **idempotence** — un rappel déjà envoyé ne ressort jamais. Le job peut tourner
   toutes les minutes sans inonder l'acheteuse ;
2. **rattrapage** — un rappel dont l'heure est passée ressort tant qu'il n'a pas
   été envoyé. Un job arrêté trois heures ne perd pas le rappel de 2 h ;
3. **aucun rappel après l'expiration** — rappeler une commande morte ne sert qu'à
   faire honte à l'acheteuse.

## Le garde de pureté, et ce qu'il attrape de plus

La définition de terminé demande un test qui échoue si `src/domain` contient
`from "@prisma`, `from "hono`, `fetch(` ou `Date.now(`. Il est écrit, et il teste
**ses propres expressions de détection** : une expression cassée ferait passer les
quatre contrôles en silence sur tout le répertoire.

Trois contrôles ont été ajoutés, parce qu'ils préviennent le même défaut et que la
liste littérale ne les couvre pas :

- **`new Date()` sans argument** — c'est `Date.now()` déguisé, et le motif de la
  définition de terminé ne l'attrape pas ;
- **`Math.random()`** — même discipline que l'horloge : `genererCodeOtp` et
  `cleOpaque` reçoivent leur source d'octets, ce qui les rend testables sur des
  valeurs choisies ;
- **`node:fs` et `process.env`** — un domaine qui dépend de son environnement ne
  se teste pas de façon reproductible.

## La couverture porte sur le DOMAINE, pas sur le paquet

Le seuil de 90 % est appliqué à `src/domain/**` uniquement, avec
`thresholds` dans `vitest.config.ts` — donc il fait échouer la commande, ce n'est
pas un rapport à lire.

La distinction compte : `src/adapters` parle à la base et au réseau, et un seuil
global pousserait à simuler ces frontières pour faire monter un chiffre. Le
domaine est pur — s'il n'est pas couvert, c'est qu'une règle métier n'est pas
vérifiée.

`payment-provider.ts` en est exclu : c'est l'interface d'agrégateur en dormance
(ADR 0009), elle ne contient que des types et aucun chemin de code v1 ne l'atteint.

**Ce que la mesure a trouvé** : `sms-sender.ts` était à 15 % de fonctions
couvertes. Les variantes anglais et pidgin des quatre messages — dix des douze
combinaisons — n'étaient jamais exécutées. Un `${c}` oublié dans l'une d'elles
serait parti chez une vendeuse sans que rien ne le voie, et un SMS d'OTP sans code
est une vendeuse enfermée dehors. Un test couvre désormais les douze, vérifie que
chacune porte la valeur, nomme Catalog, et que les trois langues d'un même message
sont **distinctes** — un copier-coller qui laisserait le français dans la case
anglaise passait tous les autres contrôles.

Mesure finale sur `src/domain` : 98,7 % des instructions, **100 % des fonctions**,
97,8 % des branches.

## Ce que ce lot ne contient pas

Aucun analyseur de SMS, aucune construction de chaîne USSD : ce sont les lots 8 et
9. Ce lot définit les types et les transitions qu'ils alimenteront — d'où
l'événement `sms_analyse`, qui reçoit un verdict déjà rendu plutôt que du texte.

Aucun calcul de commission, et jamais : Catalog ne peut pas prélever sur un flux
qu'il ne détient pas. Un test vérifie qu'aucun champ du résultat d'un versement ne
ressemble à une commission — c'est le genre de champ qu'on ajoute « juste pour
voir ».
