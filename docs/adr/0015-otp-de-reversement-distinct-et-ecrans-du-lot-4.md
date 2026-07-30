# 0015 — L'OTP de reversement est distinct de celui de connexion, et quatre écarts du lot 4

- Statut : accepté
- Date : 2026-07-30
- Concerne le lot 4 (`apps/api`, `apps/seller`, `packages/db`, `packages/ui`)
- Ne change aucune version de la stack

## Contexte

Le lot 4 demande l'authentification par téléphone avec Better Auth 1.6 et son
plugin `phoneNumber`, et il demande que **le numéro de reversement soit un champ
distinct du numéro de connexion, vérifié par son propre OTP** (AGENTS.md §2).
Ces deux exigences se sont révélées incompatibles avec le chemin le plus court.

## Décision 1 — une table `payout_otp`, et pas le plugin `phoneNumber`

Le plugin `phoneNumber` de Better Auth vérifie **le numéro de connexion**. Son
point d'entrée `/phone-number/verify` déplace `user.phoneNumber` : l'utiliser
pour vérifier un numéro de reversement changerait la façon dont la vendeuse se
connecte.

Or c'est exactement le cas normal du produit : la double SIM. Une vendeuse se
connecte avec sa puce MTN et veut être payée sur son Orange Money. Vérifier son
numéro Orange ne doit **rien** changer à sa connexion.

D'où une table dédiée, `payout_otp`, avec trois propriétés :

- **le code n'est jamais stocké en clair** — seule une empreinte HMAC-SHA256
  l'est. Six chiffres, c'est un million de possibilités : un simple SHA-256 se
  pré-calcule en une seconde, et la clé du HMAC est ce qui rend le pré-calcul
  impossible pour qui lit la base sans avoir le secret du serveur ;
- **la ligne se consomme** — un code ne vaut qu'une fois, y compris en cas de
  succès, ce qui empêche de rejouer une saisie pour pousser un second numéro ;
- **émettre consomme les codes précédents** — deux codes valides en même temps
  doublent la surface de devinette sans rien apporter.

Le secret n'a **pas de valeur de repli codée** : un secret par défaut serait le
même partout, donc public. `PayoutOtpStore` refuse de se construire sans lui.

Le domaine (`payout-phone.ts`) reste inchangé : il ne voit toujours jamais le
code, seulement le fait « ce numéro-là a été vérifié à telle heure ».

## Décision 2 — la limitation de débit est en couche HTTP, pas dans `sendOTP`

L'adresse IP est une donnée de la requête. Enfouie dans le rappel d'envoi de
Better Auth, elle serait absente ou devinée, et la limite par adresse — celle qui
empêche de contourner la limite par numéro en faisant tourner les numéros — ne
tiendrait pas. Le contrôle vit donc dans un middleware Hono, qui décide **avant**
l'appel et n'enregistre qu'**après** une réponse réussie : compter les échecs
permettrait d'enfermer une vendeuse dehors avec des requêtes invalides.

La clé est le numéro **normalisé**. Sans cela, « 677123456 » et
« +237677123456 » compteraient séparément et trois demandes deviendraient six.

**Les plafonds sont de la configuration, pas des constantes de code.** C'est le
même raisonnement que pour les codes USSD, et il vise surtout la limite par
adresse : la traduction d'adresses des opérateurs mobiles et les points d'accès
partagés font que plusieurs vendeuses sortent régulièrement par la **même**
adresse publique. Douze demandes par heure y sont vite atteintes par des
connexions parfaitement légitimes. La bonne valeur ne se devine pas depuis un
bureau ; elle se règle avec des données de terrain, sans redéploiement. Une
valeur invalide est ignorée au profit du défaut — une faute de frappe dans la
configuration ne doit pas ouvrir la vanne.

## Décision 3 — une étape de création de profil, deux questions

Better Auth crée un compte (`user`) ; Catalog possède un profil (`seller`). Le
lot 4 avait besoin d'un `seller` pour régler le reversement, et le blueprint ne
disait pas d'où il venait.

Le nom de la boutique et la ville sont donc **demandés**, une seule fois, au
premier passage. Ils ne sont pas devinés : ce nom s'affichera sur la page
publique que ses clientes voient, et « Ma boutique » y serait une invention à son
nom. `GET /api/vendeuse/moi` renvoie `seller: null` tant qu'elle n'a pas répondu.

La route est idempotente : rappelée avec un profil déjà posé, elle le renvoie
sans rien écraser. Un double appui sur un réseau lent ne doit pas renommer une
boutique.

## Décision 4 — un point d'entrée de développement pour relire le dernier code

`GET /api/dev/dernier-code?numero=…` existe pour une seule raison : le test de
bout en bout doit parcourir le **vrai** chemin d'authentification. Le fournisseur
factice garde les messages en mémoire, mais Playwright tourne dans un autre
processus. Sans cette route, le test devrait simuler l'API — et il ne prouverait
plus rien du serveur.

Elle n'est pas gardée par un réglage à part qu'on pourrait oublier d'éteindre :
**le même objet qui la rend utile est celui qui refuse de se construire en
production**. `ConsoleSmsSender` lève si `NODE_ENV=production`, et la route ne se
monte que si le fournisseur actif est ce factice. Il n'existe donc aucun état où
elle existe et livre de vrais codes.

## Décision 5 — les modèles de Better Auth gardent leur préfixe `Auth`

Better Auth appelle `prisma[modelName]`. Nos modèles s'appellent `AuthUser`,
`AuthSession`, `AuthAccount`, `AuthVerification` — le préfixe dit à la lecture du
schéma ce qui appartient à la bibliothèque et ce qui appartient au métier, là où
un `User` nu se confondrait avec `Seller`.

La traduction se fait donc dans la configuration (`user: { modelName: "authUser" }`
et les trois autres). Ces quatre lignes sont **obligatoires** : sans elles, Better
Auth cherche `prisma.verification` et échoue en 500 au premier envoi d'OTP. Les
noms de **table** ne changent pas — ils sont posés par `@@map` et restent `user`,
`session`, `account`, `verification`.

## Le défaut que ce lot a mis au jour

`node src/server.ts` échouait au démarrage :

```
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property
is not supported in strip-only mode
```

Node 24 exécute le TypeScript en **retirant** les types, sans les transformer.
Trois constructions n'ont pas d'équivalent une fois les types retirés, parce
qu'elles **génèrent** du code : la propriété de paramètre
(`constructor(private readonly x: T)`), l'`enum`, et le `namespace` avec un corps
exécutable.

Elles compilent parfaitement sous `tsc --noEmit`, passent le lint, et passent
Vitest — qui transforme le code avec esbuild. **Aucune des cinq commandes de la
définition de terminé n'exécute réellement le serveur.** Trois fichiers étaient
touchés, dont `adapters/campay.ts`.

Corriger `campay.ts` n'est pas l'étendre au sens d'AGENTS.md §5 : le comportement
est identique au caractère près. C'est ce qui rend vraie la garantie que cette
section énonce — « il sera encore compilable le jour où on le réveille ». Un
fichier qui fait lever Node à l'import ne l'est pas.

Le garde-fou est `apps/api/src/__tests__/node-strip-only.test.ts`, qui lit les
sources et échoue sur les trois constructions. Il teste aussi sa propre
expression de détection, pour qu'une faute de frappe ne le désarme pas en
silence.

## Conséquences

- Une migration additive, `20260730120000_lot4_payout_otp`. Aucune colonne
  existante n'est touchée.
- `packages/ui` gagne `OtpField` : **un** champ, pas six cases. Six cases
  cassent l'auto-remplissage SMS, cassent le collage, et transforment une
  correction de frappe en six coups de touche arrière. Le champ est en
  `type="text"` et non `number` — `number` supprime les zéros de tête, et un code
  « 048190 » y perd son premier chiffre.
- Le collage n'est jamais bloqué (WCAG 2.2 §3.3.8, AGENTS.md §8). Trois tests le
  vérifient : deux qui lisent la source, parce qu'un `onPaste` appelant
  `preventDefault` est invisible dans le balisage, et un test Playwright qui fait
  un vrai `Ctrl+V` depuis le vrai presse-papiers du navigateur.
- Le job `e2e` de la CI reçoit PostgreSQL 18 et applique les migrations : sans
  base, le parcours vendeuse se déclare ignoré et le critère de la définition de
  terminé n'est pas vérifié.
- L'app vendeuse renvoie `/api` par le serveur Vite, en développement **et** en
  prévisualisation. Ce n'est pas un confort : le cookie de session doit être de
  même origine, sinon les navigateurs mobiles courants le bloquent et la vendeuse
  est déconnectée à chaque ouverture, sans message qui l'explique.
