# AGENTS.md — contrat de travail

> Ce fichier est lu au début de **chaque** session. Il prime sur toute habitude,
> tout tutoriel et toute convention apprise ailleurs. En cas de contradiction
> entre ce fichier et une pratique répandue, **ce fichier gagne**.
>
> Révision du 29/07/2026 — architecture v1 **sans agrégateur**, conformément à
> l'ADR 0009. Si tu as en mémoire une version parlant d'agrégateur, de webhook
> de paiement ou de `WAITING_FOR_CUSTOMER`, elle est périmée.

---

## 1. Le produit en cinq lignes

> **Le produit s'appelle Catalog**, avec une majuscule et sans « ue ». Il
> s'appelait Swap jusqu'au 29/07/2026 ; voir l'ADR 0010. Les ADR 0001 à 0009
> gardent l'ancien nom : un ADR n'est jamais réécrit.
>
> Attention à la collision : **Catalog** est le produit, **catalogue** est le
> nom commun — la liste d'articles d'une vendeuse. Le second reste en français
> partout, y compris dans les identifiants de code déjà écrits.

Catalog outille les vendeuses camerounaises qui vendent **déjà** sur WhatsApp.
On n'y déplace pas la transaction : on ajoute par-dessus la conversation un
catalogue partageable, une rampe de paiement mobile money, un suivi de commande
et une réputation vérifiée. L'acheteuse et la vendeuse continuent de se parler
sur WhatsApp — c'est un invariant produit, pas une étape transitoire.

**La valeur numéro un n'est pas le catalogue. C'est la preuve de paiement
opposable** : un reçu portant l'identifiant de transaction de l'opérateur, dans
un marché où la capture d'écran MoMo truquée est l'arnaque la plus courante.

---

## 2. Contraintes non négociables

Toute violation d'un point de cette section est un défaut bloquant, même si le
code fonctionne et que les tests passent.

### Argent
- Le franc CFA **n'a pas de sous-unité**. Tous les montants sont des **entiers**,
  suffixés `_xaf`. Jamais de `float`, jamais de `decimal`, jamais de division
  sans arrondi explicite et testé.
- Un acompte de 50 % sur 7 501 F vaut **3 750 F**, et le solde **3 751 F**.
  La règle est `floor` sur l'acompte, le reste au solde : le total est préservé
  exactement, et le franc perdu à l'arrondi n'existe pas. C'est ce qu'implémente
  déjà `splitDeposit` dans `packages/contracts/src/money.ts`, couvert par un test
  de propriété sur 10 000 montants. **Ne pas le « corriger ».**
  L'invariant `amount_paid_xaf + balance_xaf = total_xaf` est garanti par une
  contrainte de base de données, pas par le code applicatif.
- **Orange affiche des décimales** sur ses soldes (`108762.45 FCFA`). Tout
  montant lu dans un SMS est ramené à l'entier **au moment de l'analyse**, avant
  d'entrer où que ce soit dans le système.
- Aucune donnée de carte bancaire ne transite par nos serveurs, jamais.

### Paiement — l'architecture v1

**L'invariant d'architecture le plus important du produit :**

> **Les fonds ne transitent jamais par un compte contrôlé par Catalog.**
> Ils vont du portefeuille de l'acheteuse vers celui de la vendeuse, en **dépôt
> direct**, sans tiers. Catalog n'initie rien, ne détient rien, n'encaisse rien.

Ce n'est pas une préférence, c'est ce qui définit la nature du produit. Le
statut réglementé d'« établissement de paiement » (Règlement CEMAC 04/18) est
détenu par ceux qui **opèrent** le réseau et détiennent les fonds — Orange
Money Cameroun S.A., agréée par arrêté n° 00000373/MINFI du 5 mai 2022, et
MTN Mobile Money Corporation, agréée le 16 mai 2023. Catalog **utilise** ces
réseaux, il n'en crée aucun. Utiliser un service de paiement n'est pas en
fournir un : sinon toute boutique en ligne acceptant MoMo serait en infraction.

Trois corollaires qui découlent directement de l'invariant :

1. **On ne peut pas prélever de commission sur un flux qu'on ne détient pas.**
   Le revenu vient de l'abonnement — 2 500 F par mois, **0 % de commission**.
   Ce n'est pas un argument commercial choisi, c'est une conséquence
   structurelle. Ne jamais écrire de code de calcul de commission.
2. **La vendeuse encaisse sur le portefeuille mobile de son choix.** Elle en a
   déjà un : aucun compte à ouvrir, aucun registre de commerce à fournir.
3. **Il n'y a ni webhook de paiement, ni API d'agrégateur, ni machine à états
   pilotée par un tiers.** Catalog n'observe pas le paiement en direct. Il le
   constate ensuite, par la preuve.

**Le numéro de reversement est un champ distinct du numéro de connexion**,
vérifié par son propre OTP. La double SIM est la norme : une vendeuse se
connecte avec sa puce MTN et veut être payée sur son Orange Money. Toute
modification de ce numéro exige une nouvelle vérification — c'est le champ
qu'un attaquant chercherait à détourner.

### La rampe de paiement

Catalog ne déclenche aucun transfert. Il **pré-remplit le clavier** de
l'acheteuse.

- Un lien `tel:` porte la chaîne USSD complète, avec le `#` encodé `%23`.
  Le composeur s'ouvre garni ; l'acheteuse appuie sur appeler. Pas d'application
  à installer, pas de permission à accorder.
- **Le code d'entrée dépend de l'opérateur et n'est jamais une constante en
  dur.** `*126#` chez MTN, `#150*50#` chez Orange. Il vit dans la configuration,
  par opérateur, et se change sans redéploiement — les opérateurs les modifient.
- **Le code secret se saisit dans la session de l'opérateur.** Catalog ne le
  voit jamais, ne le demande jamais, n'a aucun champ où il pourrait être saisi.
- Les raccourcis paramétrés (chaîne complète sautant les niveaux de menu) sont
  **non vérifiés sur téléphone réel**. Toute chaîne au-delà du code d'entrée est
  une hypothèse : elle doit être marquée telle quelle dans la configuration, et
  l'interface doit rester utilisable si le raccourci échoue.

### La preuve par SMS — le cœur du produit

Catalog n'a pas besoin de **vérifier** le paiement. Il a besoin de le rendre
**vérifiable**. C'est la phrase à relire quand une décision de conception
hésite.

La vendeuse colle le SMS que son opérateur lui a envoyé. Catalog l'analyse et
applique **sept contrôles** :

| # | Contrôle | Ce qu'il attrape |
|---|---|---|
| 1 | Format opérateur reconnu | Le texte inventé, la capture retapée |
| 2 | Montant conforme | Le sous-paiement déguisé |
| 3 | Contrepartie | Le paiement destiné à quelqu'un d'autre |
| 4 | Horodatage cohérent | Le SMS antérieur à la commande, le SMS recyclé |
| 5 | Unicité de l'identifiant **sur tout le réseau** | Le même paiement réclamé deux fois |
| 6 | Identifiant auto-cohérent *(Orange uniquement)* | L'identifiant fabriqué |
| 7 | Contre-signature de l'acheteuse | La collusion à une seule voix |

Règles qui découlent de ce mécanisme :

- **Seul le SMS reçu par la vendeuse peut prouver un paiement.** C'est elle qui
  a l'argent, donc c'est son message qui fait autorité. La fraude dominante du
  marché — la fausse capture envoyée par un faux acheteur — disparaît
  structurellement, parce que la personne qui apporte la preuve est celle dont
  l'argent est en jeu.
- **Le SMS d'émission de l'acheteuse est une CORROBORATION, jamais une preuve.**
  Les analyseurs le lisent — il porte le même identifiant de transaction que
  celui de la vendeuse, ce qui offre un recoupement gratuit —, mais il ne peut
  à lui seul faire passer une commande en « prouvé ». Concrètement : un message
  de sens `sortant` produit au mieux « accepté sous réserve », en attente du
  message entrant ou de la contre-signature.
- **Une capture d'écran n'est pas une preuve et ne doit jamais être acceptée
  comme telle.** Elle ne porte aucun identifiant contrôlable. Si l'interface en
  accepte une, c'est en pièce jointe illustrative, jamais en entrée de contrôle.
- **Le contrôle 5 est réseau-large, pas commande-large.** Un identifiant
  d'opérateur ne vaut qu'une fois, chez toutes les vendeuses. C'est une
  contrainte `UNIQUE` en base sur `(operator, operator_tx_id)`, pas un `if`.
- **Le SMS d'émission nomme le destinataire ; celui de réception nomme
  l'expéditeur.** Les comparer au même numéro de référence rejetterait tous les
  paiements légitimes. Le contrôle 3 doit connaître le sens du message.
- **Ne jamais réconcilier par numéro de téléphone seul.** Double SIM et paiement
  depuis le téléphone d'un proche sont la norme : un numéro qui ne correspond
  pas est un **avertissement**, jamais un rejet. La clé est l'identifiant de
  transaction.
- Un paiement **ne recule jamais**. Toute transition arrière est journalisée
  puis ignorée.
- Le **dépôt direct non prouvé** existe et existera toujours. Il se déclare
  manuellement, fait avancer la commande, et reste marqué **non tracé** : pas de
  reçu, pas d'avis vérifié. On ne cherche pas à le bloquer, on le distingue.

### Contexte camerounais
- **Il n'existe pas d'adresse postale.** Aucun champ `address`. La livraison se
  saisit en `{ mode, city, quartier, landmark, phone, geo? }`, avec `landmark`
  et `phone` obligatoires. Le point de retrait convenu est un mode de livraison
  de plein droit, pas un cas dégradé.
- Le message WhatsApp généré doit être **autosuffisant en texte brut**. Contenu
  canonique, à ne pas décliner autrement ailleurs : **article, quantité, prix
  unitaire, total, nom de la boutique** — et, dès qu'une commande existe,
  **référence et code de vérification**. Avant la création de la commande, ces
  deux derniers champs n'existent pas et ne s'inventent pas. Le lien est un
  confort, jamais le seul porteur d'information — certains acheteurs sont sur un
  forfait où les liens externes peuvent échouer.
- Interface en français simple. Prévoir dès la conception les variantes anglais
  et pidgin pour les **messages sortants**. Le pidgin n'est pas réservé aux
  régions anglophones. **Les opérateurs écrivent aussi en anglais** : les
  analyseurs doivent accepter les deux langues, ce n'est pas une option future.
- **Le fuseau est `Africa/Douala`**, UTC+1 sans heure d'été. Serveur, conteneurs
  et tests tournent avec `TZ=Africa/Douala`. Les dates lues dans les SMS sont en
  heure locale : sans ce réglage, la fenêtre de 48 h du contrôle d'horodatage
  dérive d'une heure et les tests passent en local puis échouent en CI.
- Le transfert **hors réseau coûte 2,22 %** (mesuré : 378 F sur 17 000 chez MTN
  vers Orange). Sur réseau, une promotion à 0 F s'applique par périodes. Toute
  affirmation de gratuité dans l'interface doit distinguer les deux cas.

### Performance — c'est ce que « premium » veut dire ici
- Boutique publique : **≤ 30 Ko de JS** compressés sur le chemin critique,
  **≤ 120 Ko** de poids total en première visite. La CI échoue au dépassement,
  et le budget compte le contenu des `<script>` **en ligne**.
- **Aucune police téléchargée** sur la boutique publique. Pile système.
  Une police de marque est tolérée dans l'app vendeuse (mise en cache par le
  service worker), sous-ensemblée et préchargée.
- LCP < 2,5 s et INP < 200 ms en profil **Slow 4G bridé**, pas en local.
- Les tests de bout en bout s'exécutent sur un profil mobile bas de gamme bridé.

### Accessibilité
- **WCAG 2.2 niveau AA.** Zéro violation bloquante axe-core dans la CI.
- Cibles tactiles **≥ 44 px**.
- Le champ OTP **doit** accepter le collage et l'auto-remplissage SMS
  (critère 3.3.8). Bloquer le collage est une régression, pas une sécurité.
  **Le champ de collage du SMS opérateur suit la même règle**, en plus fort :
  c'est un champ dont l'usage entier est le collage.
- `prefers-reduced-motion` respecté partout, sans exception.
- Chaque écran possède ses quatre états : chargement, vide, erreur, **hors ligne**.

---

## 3. Stack — versions figées

Vérifiées le 28/07/2026. Ne pas mettre à jour une version majeure sans ADR.

| Rôle | Choix | Version |
|---|---|---|
| Boutique publique | Astro | 7.1.x |
| App vendeuse | React Router (SPA + PWA) | 8.3.x |
| API | Hono sur Node | 4.12.x / Node 24 LTS |
| Base | PostgreSQL | 18.x |
| ORM | Prisma | 7.9.x |
| Auth | Better Auth + plugin `phoneNumber` | 1.6.x |
| Jobs | pg-boss | 12.x |
| Style | Tailwind (config CSS-first) | 4.3.x |
| Composants | shadcn CLI sur Base UI | 4.16.x / 1.6.x |
| Animation | Motion (imports ciblés) | 12.43.x |
| **TypeScript** | **6.x — PAS 7** | TS 7 ne supporte pas encore Astro |
| Outils | pnpm 11 · Biome 2.5 · Vitest 4.1 · Playwright 1.62 | |

pg-boss reste utilisé — relances d'expiration de commande, rappels de solde,
travaux de maintenance — même s'il n'y a plus de re-vérification de paiement.

### Pièges de version — ces habitudes sont périmées en 2026
- ❌ `tailwind.config.js` → la configuration est en CSS via `@theme`.
- ❌ `.eslintrc.js` → ESLint 10 impose la flat config ; ici on utilise **Biome**.
- ❌ Jest, webpack → Vitest et Vite.
- ❌ Lucia, `oslo` → dépréciés sur npm.
- ❌ Auth.js / NextAuth v5 → en bêta depuis plus de deux ans.
- ❌ Drizzle → pas de 1.0 stable ; on utilise Prisma 7.
- ❌ Node 18 et 20 → fin de vie.
- ❌ `middleware.ts`, `next lint`, `experimental.ppr`, params synchrones → conventions Next abandonnées.
- ❌ `size-limit` sur un glob vide → il échoue alors que zéro JS est le résultat
  **voulu**. On utilise `apps/shop/scripts/budget.mjs`.

---

## 4. Structure du dépôt

```
apps/shop      Astro — catalogue public, page publique de vérification de reçu, suivi
apps/seller    React Router SPA + service worker
apps/api       Hono
  src/domain   logique métier pure, testable sans base ni réseau
    /proof     analyseurs SMS, sept contrôles, décodeur d'identifiant Orange
    /order     machine à états, acompte, expiration
    /ramp      construction des chaînes USSD et des liens tel:
  src/adapters stockage, envoi de SMS sortants — derrière interfaces
  src/routes   HTTP mince : valide, délègue, sérialise
  src/jobs     pg-boss
packages/contracts  schémas Zod partagés = source de vérité des types
packages/db         schéma Prisma, migrations, seeds
packages/ui         jetons de design + primitives
docs/adr            une décision = un fichier numéroté, jamais réécrit
docs/formats-sms-operateurs.md   la vérité terrain — SMS réels et motifs validés
docs/terrain/                    instruments de test de terrain
  rampe-paiement.html            page autonome pour tester les codes USSD sur
                                 un vrai téléphone à Douala
```

**Règle de dépendance** : `domain` ne dépend de rien. `routes` et `jobs`
dépendent de `domain`. Les `adapters` implémentent des interfaces définies dans
`domain`. Aucun import de Prisma dans `domain`.

**`src/domain/proof` est du texte vers des données.** Pas de base, pas de
réseau, pas d'horloge implicite : le temps courant est passé en paramètre, pour
que les tests soient déterministes.

---

## 5. Le code agrégateur en dormance

`apps/api/src/adapters/campay.ts` et ses tests **restent dans le dépôt**. Ils
sont l'aboutissement d'une investigation documentée (ADR 0008) et redeviendront
utiles si un agrégateur garantit un jour à la fois le modèle sous-marchand et
le renseignement de la référence opérateur sur les transactions abouties.

Règles :

- L'adaptateur est **inatteignable depuis un chemin de code v1**. Aucune route,
  aucun job, aucun écran ne l'appelle.
- Il est gardé derrière un drapeau `PAYMENT_AGGREGATOR_ENABLED`, **absent par
  défaut**, dont l'activation est refusée hors environnement de développement.
- Son en-tête de fichier porte un renvoi explicite à l'ADR 0009.
- Ses tests continuent de tourner en CI : c'est ce qui garantit qu'il sera
  encore compilable le jour où on le réveille.
- **On ne l'étend pas.** Toute évolution de l'adaptateur exige un nouvel ADR
  qui rouvre la décision.

---

## 6. Conventions

- **Conventional Commits**, versionnage sémantique.
- **Trunk-based** : branches courtes, squash, `main` toujours déployable.
- Migrations en **expand / contract** : ajouter, double-écrire, migrer les
  lectures, retirer. Jamais de changement destructif en une étape.
- Tout ce qui touche à l'argent ou au statut d'une commande écrit dans le
  journal d'audit en ajout seul.
- Les types viennent des schémas Zod de `packages/contracts`. On ne redéclare
  jamais un type à la main de part et d'autre d'une frontière.

---

## 7. Méthode de travail attendue

1. **Un lot par session.** Ne jamais entamer le lot suivant, même s'il paraît
   trivial. Un agent qui reçoit trois lots en livre trois moitiés.
2. **Lire avant d'écrire.** `AGENTS.md`, les ADR concernés, et le code existant
   du module touché. Pour tout ce qui touche aux SMS :
   `docs/formats-sms-operateurs.md`, intégralement.
3. **Test d'abord sur le domaine métier.** La logique d'acompte, de contrôles et
   de machine à états s'écrit en test avant implémentation.
4. **Les motifs de SMS ne s'inventent pas.** Ils sont dans
   `docs/formats-sms-operateurs.md`, écrits contre des messages réels et
   vérifiés contre eux. Un motif écrit de mémoire se casse sur l'espace avant la
   parenthèse fermante, sur le numéro à douze chiffres, ou sur l'anglais.
5. **La définition de terminé est une commande.** `pnpm test`, `pnpm build`,
   une capture d'écran. Si elle n'est pas vérifiable, elle est mal écrite —
   le signaler plutôt que d'inventer un critère.
6. **Tout écart au blueprint produit un ADR** dans `docs/adr/`. La dérive
   silencieuse est le vrai risque du développement assisté, bien avant la
   qualité du code.
7. **Signaler plutôt que combler.** Face à une ambiguïté ou une information
   manquante — format de SMS non confirmé, chaîne USSD non testée, règle métier
   floue —, s'arrêter et poser la question. Ne jamais inventer une valeur
   plausible. Un format reconstitué se marque « à confirmer » **dans le code et
   dans l'interface**, il ne se promeut jamais silencieusement.

---

## 8. Interdits

- **Encaisser sur un compte contrôlé par Catalog**, même temporairement, même
  « pour dépanner » une vendeuse sans registre de commerce. C'est le seul geste
  qui ferait basculer le produit dans le champ de l'agrément.
- **Calculer ou prélever une commission** sur une transaction. Le champ
  `commissionXaf` extrait d'un SMS Orange est la commission de l'OPÉRATEUR :
  il se lit, il ne se calcule pas, et Catalog n'en prélève jamais.
- Accepter une **capture d'écran** comme entrée d'un contrôle de paiement.
- Faire passer une commande en « prouvé » sur le seul SMS d'émission de
  l'acheteuse, sans message entrant ni contre-signature.
- Marquer « payé et prouvé » sans identifiant d'opérateur enregistré.
- Réutiliser un identifiant d'opérateur déjà réclamé, chez n'importe quelle
  vendeuse.
- Rejeter un paiement au seul motif que le numéro émetteur diffère.
- Figer un code USSD en constante dans le code.
- Demander, afficher ou stocker le **code secret** mobile money.
- Appeler l'adaptateur agrégateur depuis un chemin de code v1.
- Ajouter un champ « adresse » de livraison.
- Ajouter une police téléchargée à la boutique publique.
- Ajouter une dépendance de plus de 10 Ko compressés au chemin critique de la
  boutique sans ADR.
- Bloquer le collage dans un champ OTP ou dans le champ de SMS opérateur.
- Utiliser un flottant pour un montant.
- Écrire un secret dans le dépôt, y compris dans un test ou un commentaire.
- Mettre à jour une version majeure de la stack sans ADR.

---

## 9. Ce qui est hors périmètre pour l'instant

Reporté par décision explicite, à ne pas implémenter spontanément :
notifications multicanal (matrice de destinataires, surveillance de latence),
lecture automatique des SMS sur le téléphone, application native, réveil de
l'agrégateur, accompagnement à la formalisation RCCM et NIU, financement de
stock.

Sur la lecture automatique des SMS, la question est close et il faut le savoir
avant de la reposer : `READ_SMS` est restreint et la politique Play s'est
durcie le 15 juillet 2026 ; `SMS Retriever` ne lit que les messages émis par
notre propre serveur ; `sendUssdRequest` ne renvoie qu'une réponse unique et ne
sait pas naviguer un menu. **Le collage manuel n'est pas un pis-aller, c'est le
seul chemin ouvert.** Si son coût devient pénible pour les vendeuses, c'est un
signal de volume — donc de succès — et cela se traitera à ce moment-là, avec
des données en main.

---

## 10. Les deux inconnues de terrain

Elles ne bloquent aucun lot, mais tout code qui les touche doit le dire.

1. **Le SMS Orange de réception.** La capture disponible est tronquée : on n'a
   que l'amorce « You have received 650 FCFA of… ». Le motif est reconstitué et
   marqué `aConfirmer` ; le verdict qu'il produit est « accepté sous réserve »,
   jamais « accepté ». Chez MTN, réception comprise, tout est confirmé.
2. **Les raccourcis USSD paramétrés.** Les codes d'entrée sont confirmés, les
   chaînes complètes ne le sont pas. Elles vivent dans la configuration avec un
   drapeau `verifie: false`, et l'interface reste utilisable si elles échouent.
