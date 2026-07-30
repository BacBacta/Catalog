# 0020 — La rampe de paiement : configuration à chaud, et une page qui assume son JavaScript

- Statut : accepté
- Date : 2026-07-30
- Concerne le lot 9 (`packages/contracts/src/ussd.ts`,
  `apps/api/src/domain/ramp`, `apps/api/src/routes/rampe.ts`, `apps/shop`)
- N'ajoute aucune dépendance d'exécution ; une dépendance de développement
  (`preact-render-to-string`)

## Contexte

Catalog ne déclenche aucun transfert. Il **pré-remplit le clavier** de
l'acheteuse : un lien `tel:` porte la chaîne USSD complète, le composeur s'ouvre
garni, et la session de l'opérateur prend le relais. Tout ce qui suit — la
confirmation, et surtout le code secret — se passe hors de portée de Catalog.

Le lot pose une contrainte que le terrain avait déjà écrite, le 29/07/2026, dans
`docs/terrain/rampe-paiement.html` : **le code doit venir de la réponse de
l'opérateur, jamais d'une constante en dur.** La supposition de départ pour
Orange était `#150#` ; la vraie valeur est `#150*50#`, et c'est la réponse de
l'API de l'agrégateur qui a tranché. Un code écrit dans le code source se
remplace par un redéploiement — c'est-à-dire trop tard.

## Décision 1 — un seul fichier porte des codes, et l'environnement le remplace

`apps/api/src/domain/ramp/config.ts` est **le seul endroit du dépôt où un code
USSD est écrit**. Un test le vérifie en parcourant `apps/api`, `apps/shop`,
`apps/seller` et `packages/contracts` : toute chaîne composable — étoile ou
dièse, des chiffres, un dièse final — trouvée ailleurs fait échouer la CI.

Les valeurs qui y figurent sont un **défaut daté et sourcé**, pas une vérité.
Chacune se remplace par une variable d'environnement (`RAMPE_<OP>_ENTREE_MODELE`,
`RAMPE_<OP>_RACCOURCI_MODELE`, `RAMPE_<OP>_MIN_XAF`), et une valeur mal formée
est **ignorée au profit du défaut** — même discipline que les plafonds de
limitation de débit : une faute de frappe ne doit pas fabriquer une chaîne qui ne
compose rien.

Pourquoi un défaut plutôt que rien : sans lui, l'API ne démarre pas sans
configuration, et le premier réflexe de quelqu'un de pressé serait d'écrire le
code là où il en a besoin. Un défaut isolé, daté et testé vaut mieux qu'un défaut
dispersé.

## Décision 2 — le drapeau `verifie` ne suit pas le gabarit

Les codes d'entrée sont `verifie: true` : ils ont été **relevés**. Les raccourcis
paramétrés sont `verifie: false` : personne ne les a composés sur un téléphone
réel à Douala.

Changer un gabarit par l'environnement ne pose pas le drapeau. Il faut
`RAMPE_<OP>_RACCOURCI_VERIFIE="true"`, séparément, et c'est voulu : poser ce
drapeau est une affirmation de terrain, pas une conséquence d'une modification de
configuration. Un test le fixe.

Conséquence à l'écran, et c'est la règle du lot : **un raccourci non vérifié ne
remplace jamais le code d'entrée.** Les deux chemins sont proposés, le raccourci
d'abord parce qu'il est rapide, le menu manuel ensuite parce qu'il ne peut pas
échouer, et les étapes écrites sont sous les deux — toujours, même le jour où le
raccourci sera vérifié.

## Décision 3 — la page de paiement lit sa configuration à l'exécution

C'est le point qui a coûté le plus de réflexion, parce qu'il déroge à la règle du
lot 6 : la boutique est un site statique, sans JavaScript sur le chemin critique.

Figer les codes à la construction les rendrait faux pendant des heures le jour où
un opérateur en change — et **une chaîne USSD fausse n'échoue pas proprement,
elle ouvre un menu inattendu**. La page `/payer` lit donc `GET /api/rampe` à
l'exécution, et l'îlot est monté en `client:only`.

Ce que cela coûte, mesuré : 14,9 Ko de JavaScript compressés sur cette page, pour
un budget de 30. Le reste de la boutique est inchangé.

Ce que cela ne coûte pas : l'acheteuse sans JavaScript n'est pas laissée sans
rien. Le `<noscript>` de la page lui dit d'ouvrir le menu mobile money de son
opérateur — celui qu'elle utilise déjà toutes les semaines — et **le numéro de
reversement et le montant sont écrits en texte brut dans son fil WhatsApp**.
C'est l'ajout que le lot demande au message généré, et c'est ce qui rend la page
optionnelle plutôt qu'indispensable.

Corollaire assumé : **aucun code de repli n'est affiché quand l'API est
injoignable.** Un repli écrit dans la boutique serait exactement la constante que
le lot interdit, et il finirait par être le seul code affiché le jour où l'API
tombe — donc un code périmé, affiché avec assurance. L'écran hors ligne dit ce
qu'il sait : le menu habituel, et les deux chiffres qui sont dans WhatsApp.

`/payer` porte `noindex` : une page de paiement dans un moteur de recherche est
un appel à l'hameçonnage. Lighthouse compte cela comme un défaut de
référencement ; la catégorie SEO est donc neutralisée **sur cette page
uniquement**, par `assertMatrix`, plutôt que de laisser un avertissement
permanent qui apprendrait à ignorer les avertissements.

## Décision 4 — le test du code secret vise les CHAMPS, pas la prose

La définition de terminé demande un test qui échoue sur
`/\b(pin|code[_ -]?secret|secret[_ -]?code|mot de passe momo)\b/i` dans
`apps/shop` et `apps/seller`, ancré sur des mots entiers pour que « spinner » et
« mapping » ne le déclenchent pas.

Le motif est appliqué aux **contextes qui créent un champ ou une clé d'état** —
éléments de saisie, attributs `name`/`id`/`placeholder`/`aria-label`,
identifiants déclarés, clés d'objet — et **pas à la prose**.

Ce n'est pas un assouplissement, c'est le sens de la règle. L'écran de paiement
**doit** écrire « votre code secret ne se tape jamais sur Catalog » : c'est
l'avertissement qui protège l'acheteuse de l'hameçonnage. Un test qui
interdirait la phrase interdirait la bonne pratique, et laisserait passer un
`<input name="pin">` derrière un libellé innocent — exactement l'inverse de ce
qu'on veut. Six tests de garde vérifient que la détection attrape un vrai champ
et ne se déclenche ni sur « spinner » ni sur une phrase.

Les fichiers de test sont hors du parcours : ils affirment l'absence, donc ils
contiennent les motifs cherchés par construction. Un champ réel, lui, doit être
rendu quelque part, et ce quelque part est parcouru.

## Ce que l'écran d'attente ne dit pas

Catalog n'a aucune fenêtre sur l'opérateur : ni notification, ni API
d'agrégateur, ni résultat de session USSD. L'écran d'attente ne peut donc
annoncer ni succès ni échec, et un test vérifie qu'aucune formule de confirmation
n'y apparaît. « Paiement confirmé » affiché par un système qui ne sait rien
serait exactement le mensonge que le produit existe pour remplacer.

Ce qu'il dit est vrai et vérifiable : la vendeuse recevra le SMS de son
opérateur, et c'est en le collant qu'elle fera exister le reçu.

## Trois découvertes de la mise en œuvre

**Le contrôle de types de la boutique était éteint sur les îlots.** `astro check`
lit le `tsconfig`, qui ne portait ni `jsx` ni `jsxImportSource` : faute de
définitions de balises, **tout élément JSX devenait `any`** — trente-trois
diagnostics apparus dès que la configuration a été posée, sur du code du lot 6
qui passait la porte sans être vérifié. Les deux lignes sont désormais dans
`apps/shop/tsconfig.json`.

**Vite 8 transforme par oxc, pas par esbuild.** Poser `esbuild:` dans une
configuration Vitest n'a plus aucun effet ; l'avertissement qui le signale se
noie dans la sortie. Le réglage JSX des tests de la boutique est sous `oxc:`.

**Un identifiant de preuve construit sur quatre caractères finit par se
répéter.** `packages/db/src/__tests__/constraints.test.ts` fabriquait ses
`operator_tx_id` avec `suivant().slice(-4)` : la colonne est `UNIQUE`, la base
n'est pas remise à zéro entre deux exécutions, et le test finissait par échouer
sur une collision avec sa propre exécution précédente. Il porte maintenant le
marqueur horaire entier.

## Ce qui reste à demander au terrain

Inchangé, et toujours non bloquant : **les raccourcis paramétrés sautent-ils
vraiment les niveaux de menu ?** `docs/terrain/rampe-paiement.html` est
l'instrument prévu pour trancher — trois minutes sur un vrai téléphone à Douala.
Quand la réponse arrivera : mettre à jour le gabarit dans la configuration, puis
poser `RAMPE_<OP>_RACCOURCI_VERIFIE="true"` pour celui qui va au bout, et
supprimer les autres candidats plutôt que de les garder « au cas où ».

Les intitulés exacts des menus n'ont pas été relevés non plus : les étapes
écrites nomment les options par leur **fonction** — « l'option de transfert
d'argent » — et `etapesAConfirmer` porte cette réserve jusque dans l'interface.
