# 0099 — Le suivi acheteuse, poussé pas à pas

Date : 2026-08-15
Statut : accepté
Lot : P5 de `PROMPTS-premium.md`, sous le cadrage de l'ADR 0095.
Complète : 0021 (deux clés), 0036 (l'identité du fil), 0054 (gabarits),
0082 (« suivi » redit l'état), 0083 (le verdict aux deux), 0098 (les
transitions du fil).

## Contexte

L'acheteuse vit le moment le plus anxieux du commerce à distance — « mon
argent est parti » — et le produit ne lui parlait qu'à deux instants : le
verdict de paiement (ADR 0083) et la remise (invitation à noter). Entre les
deux, silence. La cible : chaque étape franchie par la vendeuse met à jour
un suivi DANS le fil de l'acheteuse.

## Décision 1 — UN vocabulaire de suivi, pas deux

La maquette dessinait une timeline à quatre jalons (« Acompte prouvé », « En
préparation », « Remise & solde », « Avis vérifié »). Or le fil SAIT déjà
dessiner le suivi : la réponse au mot « suivi » (ADR 0082) rend le chemin
complet — ✓ fait, ➔ en cours, ○ à venir — depuis `etapesDuSuivi`, plus le
reste à payer et le sort de la preuve. Livrer une SECONDE timeline à côté,
avec ses propres libellés, c'est deux vocabulaires pour un même état : ils
divergeraient au premier lot venu.

La carte poussée réutilise donc le rendu de « suivi », extrait en une
fonction partagée (`lignesSuivi`) : mêmes libellés par mode (un retrait n'a
pas d'étape de livreur), même ligne de reste, même ligne de preuve. La
maquette est mise à jour au même commit : sa timeline montre désormais ce
que le fil rend réellement. Ce que la timeline de la maquette portait de
plus — le paiement et l'avis comme jalons — est déjà dit par les lignes de
preuve et par l'invitation à noter : rien ne se perd, rien ne se duplique.

## Décision 2 — la politique de fenêtre : informer n'est pas réveiller

Elle n'était pas dans l'ADR 0095 ; elle s'acte ici.

- **Fenêtre acheteuse OUVERTE** : la mise à jour part immédiatement. Une
  transition = UNE carte, jamais deux messages (ADR 0086) ; deux transitions
  rapprochées font deux cartes, dans l'ordre (`envoyerSequence` envoie un
  par un).
- **Fenêtre FERMÉE** : seuls les jalons UTILES réveillent le fil par gabarit
  (ADR 0054) — le verdict de paiement (déjà fait, ADR 0083) et la remise
  (déjà fait, `commande_livree`). Les jalons INTERMÉDIAIRES — préparée,
  chez le livreur — n'ouvrent AUCUN gabarit : la carte attend en
  `bot_notification` et part à la prochaine interaction. Payer un réveil
  pour dire « en préparation » serait du confort facturé (ADR 0054), et un
  message de nuit pour un jalon sans geste attendu serait du bruit.

## Décision 3 — la carte pointe vers la page, et le lien reste dans son fil

La page de suivi web reste la référence longue ; la carte porte un bouton
`cta_url` « Voir le suivi » — l'usage légitime mesuré le 13/08 (« va voir
cette page », ADR 0087). Le lien est celui du jeton acheteuse
(`buyerToken`), et UNIQUEMENT lui : jamais la référence, jamais le code de
vérification (ADR 0021 — il suffirait d'avoir vu un reçu pour ouvrir le
suivi d'autrui).

**Ce qui est révisé, et comment la garde tient** : « le jeton ne se projette
jamais » est une garde STRUCTURELLE — `jeton-jamais-expose.test.ts` lit les
sources et refuse tout `select` de `buyerToken`. Elle n'est pas affaiblie :
elle gagne une troisième exception NOMMÉE, `suivi-pousse.ts`, seule
projection permise, vérifiée par le même test — le patron de
`domain/ramp/config.ts`, seul fichier à codes USSD. C'est sûr parce que le
lien part dans LE MÊME fil qui l'a reçu à la confirmation — le canal
d'origine du jeton, le seul à le détenir. Aucune exposition nouvelle ; la
garde reste entière partout ailleurs (« suivi » tapé continue de renvoyer au
lien existant, les notifications de preuve aussi). Réserve d'affichage de
l'ADR 0087 maintenue : `cta_url` est ACCEPTÉ par l'API, son rendu se
constate dans un fil réel — le corps de la carte reste autosuffisant en
texte, le bouton n'est qu'un confort.

## Décision 4 — la contre-signature ouvre le suivi

La carte de remerciement de la contre-signature (ADR 0036) gagne le suivi à
sa suite, en UNE bulle — c'est le pas « cible » de la maquette : « Voici
votre suivi — il se mettra à jour tout seul ». La copie existante de
`contresigneMerci` n'est pas réécrite : le suivi s'y AJOUTE. C'est le moment
exact où l'anxiété commence (l'argent est parti, la preuve est faite, il ne
reste qu'à attendre) — donc le moment d'installer la carte qui bougera.

## Ce que ce lot NE fait pas

- Aucun détail de preuve dans la carte : le verdict, pas la matière
  (ADR 0023 — et le SMS brut ne voyage jamais).
- Le fil vendeuse ne change pas ; l'app ne change pas.
- La copie existe en FR et EN (et `wes`, écrite non servie — ADR 0034).

## Preuves

- `apps/api/src/domain/bot/__tests__/suivi-pousse.test.ts` — le rendu
  partagé (`lignesSuivi` : ✓/➔/○, reste, preuve), la bulle de
  contre-signature qui porte le suivi, la forme du message `cta_url`.
- `apps/api/src/__tests__/bot-suivi.test.ts` — contre une vraie base : le
  parcours complet vu du fil acheteuse (démonstration du lot) — préparée
  poussée en fenêtre ouverte avec le bouton « Voir le suivi » ; fenêtre
  fermée + jalon intermédiaire → rien ne part, la carte attend en base ;
  fenêtre fermée + remise → le gabarit `commande_livree` ; deux transitions
  rapprochées → deux cartes, dans l'ordre.
