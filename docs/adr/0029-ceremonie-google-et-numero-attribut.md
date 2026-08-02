# ADR 0029 — La cérémonie Google, et le numéro qui devient un attribut

- **Statut** : accepté
- **Date** : 01/08/2026
- **Lot** : celui-ci
- **Concerne** : `apps/api/src/auth.ts`, `apps/api/src/auth-connexion-whatsapp.ts`
  (endpoint d'état), `apps/api/src/routes/seller.ts`,
  `apps/seller/src/routes/Connexion.tsx`, `apps/seller/src/routes/Dashboard.tsx`,
  `apps/seller/src/lib/api.ts`, `.env.example`, `docs/maquettes/google-passkey.html`
- **Amende** la règle « pas d'authentification par e-mail » — voir la section
  dédiée. **Complète** les ADR 0027 (WhatsApp entrant) et 0028 (architecture
  cible) : une troisième cérémonie, pas un remplacement.

## Contexte

La journée du 01/08/2026 a montré que chaque cérémonie d'identité disponible
attend un gardien : listes blanches d'expéditeur chez Orange, validation de
sender chez MboaSMS, vérification d'entreprise chez Meta. Trois guichets,
trois minuteurs, zéro levier.

Or chaque Android vendu avec le Play Store porte déjà un compte Google — c'est
une condition d'usage du téléphone, pas une habitude de lettrés. Et c'est **le
même compte** qui synchronise les passkeys de l'ADR 0028 : celui qui connecte
au jour 1 est celui qui ressuscite la clé sur le téléphone suivant.

## L'amendement du contrat, précisément

La règle historique — « il n'y a PAS d'authentification par e-mail dans ce
produit » — combattait deux choses : la saisie d'une adresse au clavier, et
les codes envoyés dans une boîte que personne ne lit. **Ces deux interdits
restent entiers.** Ce que cet ADR autorise est strictement plus étroit :

> Le bouton « Continuer avec Google » — un sélecteur de compte système, un
> appui, aucune adresse saisie, aucun e-mail envoyé, jamais.

L'adresse Google devient la clé technique du compte (le champ `email` que
Better Auth exige portait jusqu'ici une valeur en `.invalid`) ; **aucun écran
ne la demande, aucun message ne part dessus** — la règle d'origine, mot pour
mot, continue de s'appliquer à l'adresse.

## Décision 1 — la cérémonie Google

`socialProviders.google` de Better Auth, **en dormance** derrière
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — le même geste que le WABA et le
`PASSKEY_RP_ID` : absentes, rien n'est monté, et l'app vendeuse n'affiche pas
le bouton (l'endpoint d'état des cérémonies le dit). La configuration est en
libre-service dans la console Google Cloud : **c'est la seule cérémonie sans
dossier à déposer nulle part.**

Le flux est une redirection OAuth classique : l'app demande l'URL à l'API,
le navigateur part chez Google, revient sur `/api/auth/callback/google`, et
Better Auth pose la session puis renvoie vers `/cle` — où la proposition de
passkey (ADR 0028) enchaîne naturellement. One Tap est noté comme amélioration
future ; la redirection suffit et n'ajoute aucune dépendance cliente.

## Décision 2 — le numéro devient un attribut

Le téléphone reste **l'identité produit** — le `wa.me` de la boutique, le
contact des acheteuses, l'ancrage du reversement. Mais il cesse d'être la
seule porte d'entrée, et la découverte de ce lot est que le modèle de données
le permettait déjà :

- **`Seller.phone` (`@unique`) est le numéro de contact de la boutique.**
  Jusqu'ici il était *dérivé* du numéro de connexion ; il devient
  *déclarable* à la création du profil quand le compte n'a pas de numéro
  vérifié (arrivée par Google). Aucune migration.
- **Le numéro déclaré est déclaratif, et c'est un choix de sécurité autant
  que d'ergonomie** : une vendeuse qui le saisit faux prive *ses propres
  clientes* de la joindre — l'erreur se punit toute seule et se corrige dans
  Réglages. L'unicité de `Seller.phone` empêche au passage de squatter le
  numéro d'une boutique existante.
- **Le numéro de reversement ne change pas d'un iota** : OTP strict vers ce
  numéro, comme avant, sur le canal SMS dès qu'il vit.

**La frontière qui interdit le détournement de compte** : les cérémonies
téléphone (OTP, WhatsApp entrant) retrouvent un compte par `user.phoneNumber`
— le numéro *vérifié*. Le numéro déclaré vit dans `Seller.phone` et **n'entre
jamais** dans cette recherche. Déclarer le numéro d'autrui ne crée donc aucun
lien d'authentification : au pire une collision d'unicité, jamais une prise de
compte.

## Ce qui est dit et non comblé (AGENTS.md §7.7)

- **La liaison entre cérémonies n'existe pas encore.** Une vendeuse qui entre
  par Google puis, des mois plus tard, par WhatsApp, obtiendrait deux comptes.
  Avec zéro utilisatrice réelle, c'est un non-problème d'aujourd'hui et un
  chantier connu de demain ; la règle de fusion devra exiger des preuves
  *vérifiées* des deux côtés. À trancher par un ADR le moment venu.
- **L'hypothèse « chaque vendeuse a un compte Google à elle » est un fait de
  terrain, pas un fait établi** — téléphones configurés en boutique, comptes
  partagés. La question est à poser à Douala ; en attendant, les portes
  WhatsApp et SMS restent sur le même écran, et aucune n'est un péage.
- L'écran de consentement Google affichera « application non vérifiée » tant
  que la revue (cosmétique, scopes de base) n'est pas faite.

## Conséquences

- Le lancement cesse de dépendre d'un guichet externe : Google est
  configurable aujourd'hui, la passkey enchaîne, et le seul SMS restant
  (reversement) est rare et déjà en validation chez MboaSMS.
- Aucune dépendance nouvelle : `socialProviders` est dans le cœur de Better
  Auth, et le flux par redirection n'ajoute rien côté client.
- La maquette `docs/maquettes/google-passkey.html` est la spécification
  visuelle — le sélecteur de compte, l'écran du numéro-attribut, la variante
  sans compte Google.
