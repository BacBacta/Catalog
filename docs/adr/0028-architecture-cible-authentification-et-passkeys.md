# ADR 0028 — L'architecture cible de l'authentification : WhatsApp entrant + passkeys, SMS réduit au reversement

- **Statut** : accepté
- **Date** : 01/08/2026
- **Lot** : celui-ci — le lot d'assemblage des explorations du 01/08/2026
- **Concerne** : `apps/api/src/auth.ts`, `packages/db/prisma/schema.prisma`
  (modèle `AuthPasskey`), `apps/seller/src/lib/cle.ts`,
  `apps/seller/src/routes/ConnexionCle.tsx`, `apps/seller/src/routes/Appareils.tsx`,
  `apps/seller/src/routes/Connexion.tsx`, `docs/maquettes/`
- **Complète** les ADR 0025 (canal du code), 0026 (MboaSMS) et 0027 (WhatsApp
  entrant). Fixe la **destination** pour que les lots suivants s'y emboîtent.

## Contexte

La journée du 01/08/2026 a établi par la mesure que tout ce qui rend fragile
l'authentification par SMS est hors de notre contrôle : listes blanches
d'expéditeur par opérateur (Orange), validation de sender (MboaSMS), catalogue
fermé (MTN). Trois guichets, trois minuteurs, zéro levier.

Deux mécanismes explorés le même jour n'ont pas cette dépendance : la
**connexion par WhatsApp entrant** (ADR 0027 — la vendeuse envoie, Catalog
reçoit, le numéro est attesté par Meta) et les **passkeys** (WebAuthn — la clé
vit dans le téléphone, la vérification est locale puis cryptographique).

## Décision : la cible

L'authentification de Catalog converge vers cette division du travail :

| Moment | Mécanisme | Dépend de | Coût |
|---|---|---|---|
| Inscription, nouvel appareil, récupération | **cérémonie WhatsApp entrante** | Meta | 0 F |
| Connexion quotidienne | **passkey** | personne — local | 0 F |
| Vérification du numéro de reversement | **OTP SMS** vers ce numéro | un canal SMS | ~15 F, rare |

Trois propriétés en découlent, et elles sont le but :

1. **Catalog n'envoie plus jamais de SMS pour connecter quelqu'un.** Les
   listes blanches d'opérateurs ne touchent plus que la dernière ligne — un
   volume minuscule, sans urgence, déjà en validation chez MboaSMS.
2. **Aucun code n'est jamais transcrit**, de l'inscription au quotidien. Deux
   appuis pour naître, un toucher pour vivre. Pour un public à alphabétisation
   variable, c'est la friction entière du produit qui disparaît.
3. **La garantie de l'ADR 0025 est restaurée par l'architecture** : la
   connexion (WhatsApp/empreinte) et le reversement (SMS) ne partagent plus
   jamais un canal. L'aiguillage n'est plus un cas spécial — c'est la
   structure.

L'OTP SMS de connexion **reste câblé** comme repli universel : une vendeuse
sans WhatsApp existe peu, mais elle existe, et c'est aussi le filet de
récupération quand tout le reste manque.

## Ce que ce lot implémente

**Côté serveur** — le plugin `@better-auth/passkey` (1.6.25, versionné en
parallèle de Better Auth ; dépendance nouvelle, c'est l'un des objets de cet
ADR), monté **en dormance** : sans `PASSKEY_RP_ID`, il n'existe pas — points
d'entrée en 404, même geste que le canal WhatsApp sans WABA. La table
`passkey` (`AuthPasskey`, préfixe de convention) arrive par migration expand
dès maintenant : une table n'attend pas son consommateur.

Le type de retour de `createAuth` devient une **interface structurelle**
(`InstanceAuth`) : l'inférence complète référerait des types non portables de
`@simplewebauthn` (TS2883), et le serveur ne consomme que `handler`,
`getSession` et `$context`.

**Côté vendeuse** — tout est **chargé paresseusement** (`lib/cle.ts`) : le
client Better Auth et le plugin n'entrent dans le paquet initial d'aucun
écran. Trois surfaces :

- la **proposition de scellement** (`/cle`), une fois, après une connexion
  réussie — jamais un péage, un « Plus tard » vaut réponse, et l'écran
  s'éclipse seul si le navigateur ou le serveur ne suivent pas ;
- le bouton **« Se connecter avec l'empreinte »**, affiché seulement quand un
  indice local dit qu'une clé existe sur ce navigateur — un échec retombe sans
  bruit sur WhatsApp et le SMS, jamais un mur ;
- l'écran **« Appareils »** (`/appareils`) : chaque clé listée avec sa date et
  son statut de sauvegarde Google, révocable — c'est le geste « téléphone
  perdu », documenté par la question du 01/08/2026.

## Le piège qui commande tout : le rpID

Le `rpID` WebAuthn est épinglé au domaine de la page qui appelle
`navigator.credentials` — l'app vendeuse. **`fly.dev` et `vercel.app` sont sur
la Public Suffix List** : aucun `rpID` parent n'y est possible, et une clé
enrôlée en préproduction mourrait deux fois — liée à un hôte exact, perdue à
la migration. D'où la dormance : `PASSKEY_RP_ID` ne se pose que sur le domaine
définitif (`catalog.cm`, couvrant `app.*` et `api.*`). C'est écrit dans
`.env.example`, et c'est la raison pour laquelle ce lot livre du code **sans
l'activer**.

## Sécurité

- La passkey résiste au **SIM swap** (voler le numéro ne vole pas la clé) et
  au **hameçonnage** (la clé ne répond qu'à son domaine). La surface d'attaque
  du quotidien se réduit à l'appareil déverrouillé — qui, aujourd'hui, recevait
  déjà les OTP sans barrière biométrique : rien ne se dégrade, tout s'ajoute.
- Le **reversement garde son OTP propre** ; à terme, le changer exigera
  passkey **et** code sur le nouveau numéro — le geste le plus sensible reçoit
  la double preuve.
- La **récupération** est meilleure qu'attendu : les clés Android sont
  synchronisées avec le compte Google (`backedUp`), donc un téléphone restauré
  retrouve sa clé — avant même la nouvelle SIM. Les cas restants retombent sur
  la cérémonie WhatsApp puis, en dernier ressort, l'OTP SMS.

## Ce qui reste dit et non comblé (AGENTS.md §7.7)

- **Aucun parcours passkey n'a tourné sur un vrai téléphone** : le plugin est
  en dormance et le domaine n'existe pas. Le test de bout en bout se fera au
  moment de l'activation, avec l'authentificateur virtuel WebAuthn de
  Playwright (CDP) pour la CI — prévu, pas écrit.
- Les **préconditions d'activation** sont externes et connues : le domaine
  final (rpID), la vérification d'entreprise Meta (cérémonie), le sender
  MboaSMS validé (reversement). Les trois couraient déjà avant ce lot.
- Le prérequis Android — **un verrouillage d'écran configuré** — est traité à
  l'écran (explication, jamais un blocage), pas mesuré sur le terrain.

## Conséquences

- Deux dépendances nouvelles, versionnées en parallèle de Better Auth :
  `@better-auth/passkey` (API et app vendeuse) et `@simplewebauthn/server`
  (dev, portabilité des types). Aucune n'entre dans le chemin critique de la
  boutique publique — le budget de 30 Ko n'est pas concerné, et le client
  vendeuse est en import paresseux.
- La table `passkey` existe dans tous les environnements, vide tant que le
  canal dort.
- Les maquettes `connexion-whatsapp.html`, `passkey.html` et
  `auth-cible.html` dans `docs/maquettes/` sont la spécification visuelle de
  cette cible — la troisième montre la vie entière d'un compte.
