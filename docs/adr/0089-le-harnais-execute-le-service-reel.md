# ADR 0089 — le harnais d'audit exécute le service réel

Date : 13/08/2026
Statut : accepté

## Contexte — pourquoi un audit a besoin d'un outil, et pas d'une lecture

Un premier audit de parcours a été mené le 07/08/2026
(`docs/analyses/2026-08-07-audit-integral-du-bot.md`). Il a trouvé quatre appels
réseau non bornés — un vrai gain — et il a écrit « couvert » en tête de tableau
**sans compter**. Ses conclusions venaient de la lecture du code.

Lire une fonction dit ce qu'elle *prétend* faire. Seule une exécution dit ce
qu'elle fait. La différence n'est pas théorique : au premier passage du harnais
décrit ici, deux résultats ont contredit ce qu'une lecture attentive laissait
attendre, et l'un d'eux était un **artefact du harnais lui-même** (voir plus
bas). Un audit qui n'exécute pas ne peut pas faire cette différence — il rapporte
ses artefacts avec le même aplomb que ses trouvailles.

## Décision — le harnais pilote `traiterLivraisonBot`, pas une copie

Le harnais vit dans `apps/api/src/__tests__/harnais/`. Il pousse des livraisons
Meta dans **`traiterLivraisonBot`**, le service réel, contre une **vraie base**,
avec un envoyeur en mémoire.

Trois options existaient. La deuxième a été écartée, et il faut savoir pourquoi.

1. **Piloter les machines pures** (`reagirAcheteuse`, `reagirInscription`,
   `avancerComptoir`). Simple, rapide, sans base. Mais l'entrée dans le fil
   vendeuse, la lecture des formulaires, la création de boutique, la création de
   commande, l'idempotence des relivraisons et la péremption des états vivent
   dans `bot.ts` — **2 737 lignes** qu'un tel pilote ne touche jamais. Le
   parcours vendeuse y serait mesuré à côté de son propre sujet.
2. **Ré-implémenter l'orchestration dans un simulateur.** C'est l'option qui
   paraît la plus complète, et c'est la pire : le harnais testerait sa propre
   copie. Une divergence entre la copie et le produit serait exactement le défaut
   qu'il ne verrait jamais. AGENTS.md §6 interdit déjà la seconde source de
   vérité sur l'argent ; la raison vaut ici mot pour mot.
3. **Piloter le service réel.** Retenue.

### Ce que cela impose, et qu'on accepte

- **Le harnais ne peut pas vivre dans `src/domain`.** Le domaine s'interdit
  Prisma, et `domaine-pur.test.ts` le vérifie en balayant tout le répertoire,
  `__tests__` compris. Le prompt d'audit suggérait
  `src/domain/bot/__tests__/harnais.ts` ; c'est la règle du dépôt qui a choisi
  l'emplacement, pas une préférence.
- **Il exige `DATABASE_URL`**, comme `bot-comptoir.test.ts` et les autres tests
  d'intégration. Sans base, il se déclare ignoré. La CI en a une.
- **Il consomme des identifiants de test.** Trois blocs lui sont réservés dans
  `_identifiants.ts` (24, 25, 26) — un balayage crée une scène par étape, et la
  borne de 99 identifiants par exécution **lève** au lieu de boucler.

## Ce que le harnais mesure, et ce qu'il ne mesure pas

Le compteur de couverture croise **22 étapes** des deux parcours par **22
familles de geste** : 484 cases, dont le dénominateur est posé d'avance dans
`couverture.ts` et ne peut donc pas être réduit pour faire monter un
pourcentage. Une case non exercée est `non mesuré` — **jamais** `guidé`.

**Ce qui reste hors de portée, et qui ne doit jamais être compté comme sain :**

- l'envoyeur est en mémoire. Ce qui se passe **après** l'envoi — refus HTTP de
  Meta, gabarit hors fenêtre de 24 h, média introuvable — n'est pas exercé ;
- le média entrant n'est pas téléchargé : aucun `LecteurMedia` n'est branché ;
- la boutique publique, l'app vendeuse et les jobs pg-boss ne sont pas pilotés ;
- **la base locale est PostgreSQL 16**, alors que la pile épingle 18 (AGENTS.md
  §3). La CI, elle, tourne bien sur `postgres:18-alpine`. Un comportement qui
  différerait entre les deux majeures ne serait pas vu en local.

## Deux corrections que seule l'exécution a produites

Elles sont consignées parce qu'elles sont l'argument entier de cet ADR.

1. **Le harnais rangeait des cases sous la mauvaise étape.** Le statut de
   vendeuse était passé en paramètre à la construction de la scène. Or une
   prospect **devient** vendeuse au milieu de son propre parcours : ses tours
   suivants étaient comptés sous « acheteuse à l'accueil », une étape qu'elle
   n'occupait plus. Un compteur qui range sous la mauvaise ligne est pire qu'un
   compteur absent — il donne un chiffre faux. Le statut se relit désormais à
   chaque tour, comme le service le relit.
2. **Le balayage fabriquait ses propres constats.** Les vingt-deux gestes d'une
   étape se jouaient dans le même monde : le geste « formulaire complet » créait
   une boutique, et les gestes suivants s'entendaient répondre « Une boutique
   existe déjà sur ce numéro ». Rapporté tel quel, c'était un défaut produit
   imaginaire. Le monde revient donc à neuf avant chaque geste.

La seconde correction a buté sur une contrainte SQL, et c'est une bonne
nouvelle : `order_event` est en **ajout seul**, la base refuse le `DELETE`
(lot 3). Une commande créée pendant le balayage n'est donc pas effaçable. Le
harnais ne contourne pas — un journal d'audit qu'un test peut effacer n'en est
pas un. Il laisse les commandes et vide seulement ce qui contamine.

## L'instantané est le livrable, et sa neutralisation en est la moitié

Chaque scénario s'écrit en transcription lisible (`instantane.ts`), comparée à
un fichier versionné. Une régression de copie — un bouton qui disparaît, une
question qui cesse d'être posée — se voit alors dans un **diff**, pas dans une
relecture.

Les valeurs volatiles sont neutralisées, et cette neutralisation a demandé deux
corrections qui disent sa vraie difficulté :

- le premier jet transformait « Votre boutique **en** ligne » en « Votre boutique
  ‹slug› ligne » : une neutralisation qui abîme la copie détruit exactement ce
  que l'instantané protège ;
- le deuxième écrivait `boutique.test/‹slug›?numero=…` là où le produit dit
  **`/payer`**, et `‹slug›/?c=` là où il dit **`/v/`**. L'instantané cachait donc
  les deux URL dont le produit dépend le plus (ADR 0021). La liste des routes
  connues est désormais fermée, et elle doit grandir avec elles.

## Conséquences

- `pnpm test` exécute le harnais. Un parcours qui devient muet fait rougir la CI.
- Le tableau de couverture et la liste des cases muettes sont **produits par
  exécution** dans `apps/api/src/__tests__/harnais/instantanes/`. Ces trois
  fichiers ne s'écrivent pas à la main.
- Ajouter une étape au produit sans l'ajouter à `couverture.ts` fait échouer le
  balayage : une étape jouée hors catalogue est un trou invisible du tableau, et
  le test le refuse.

## Ce qui reste ouvert

Le harnais ne juge pas. Il établit qu'une case a été **jouée** et ce que la
personne a **reçu** ; il n'établit pas que la réponse est bonne. Une case
exercée qui rend une réponse absurde reste une case exercée. Confondre les deux
serait refaire, sous une autre forme, le défaut de l'audit v1.
