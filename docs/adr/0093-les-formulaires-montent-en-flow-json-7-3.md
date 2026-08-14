# ADR 0093 — les cinq formulaires montent en Flow JSON 7.3

Date : 13/08/2026
Statut : accepté — **décidé, pas encore mesuré** (voir « la porte »)
Prolonge : ADR 0055, 0063, 0087

## Contexte — une version qui expire, et qui se recopiait

Les cinq définitions de `docs/flux-*.json` déclaraient **7.0**. Y compris
`flux-ouverture.json`, écrit **le 13/08** — un formulaire neuf, déjà sur une
version qui n'est pas la courante. La version était recopiée dans **six**
endroits sans qu'aucune constante ni aucun test ne les tienne ensemble : elle se
recopiait sans qu'on la choisisse.

Ce qui rend la question urgente plutôt qu'esthétique : **une version de Flow
JSON expire.** Elle passe par trois états — *Active*, *Frozen* (plus de nouveaux
Flows, les existants marchent), puis **Expired, où « les Flows associés cessent
de fonctionner »**. Meta annonce 90 jours avant chaque palier, et vise environ
douze mois par état.

Et l'expiration serait **silencieuse chez nous**. L'ADR 0063 veut qu'un Flow qui
ne s'affiche pas laisse la question en place : personne ne verrait d'erreur, on
verrait seulement que plus aucune vendeuse n'utilise le formulaire.

## Ce que la migration coûte réellement : un champ

L'inventaire des cinq définitions, avant de toucher quoi que ce soit :

| Composants employés | Version minimale |
|---|---|
| `Form`, `SingleColumnLayout`, `Footer`, `TextInput`, `TextArea`, `TextSubheading`, `RadioButtonsGroup`, `OptIn` | 1.0 |
| `PhotoPicker` | 4.0 — **mesuré accepté** le 12/08 |

Actions employées : `navigate` et `complete`. **Aucun `data_exchange`**, aucun
composant au-delà de 4.0, aucune fonctionnalité 5.x/6.x/7.x utilisée.

La migration est donc **un changement d'un seul champ par fichier**, sans
implication structurelle. Le diff le montre : cinq fichiers, une ligne chacun.
C'est aussi ce qui la rend peu risquée — nous ne montons pas *vers* une
fonctionnalité, nous quittons une version qui vieillit.

## Décision

Les cinq définitions déclarent **7.3**. La sonde `--mesurer-photopicker` de
`flux.mjs` la déclare aussi — `flux-version.test.ts` l'exige : une sonde qui
mesure une autre version que celle qu'on expédie ne dit rien de nous.

`--mesurer-composants` garde sa version en **argument** (défaut 7.3) : c'est
voulu, il sert justement à sonder une version qu'on n'a pas encore adoptée.

## La porte — mesurer AVANT de déposer

**7.3 n'a pas été mesurée sur notre WABA**, et c'est le point à ne pas oublier.
Les notes de version de 7.2 et 7.3 parlent de « validations renforcées » : une
définition que 7.0 tolérait peut être **refusée** en 7.3. Le risque n'est pas
théorique, c'est le seul risque de cette migration.

L'ordre n'est donc pas négociable :

1. **`depots-meta → mesurer-composants`** (version vide, donc 7.3). Son premier
   brouillon ne porte qu'un `TextInput` témoin : s'il passe, 7.3 est acceptée
   sur ce WABA pour un Flow neuf — et nos cinq définitions, qui n'emploient rien
   de plus exotique qu'un `PhotoPicker`, passeront aussi ;
2. **seulement ensuite**, `depots-meta → flux --deposer`.

Rien ne part chez Meta du fait de cet ADR : `--deposer` est un acte manuel, il
ne se déclenche jamais tout seul, et les définitions migrées dorment dans le
dépôt jusque-là.

Si le témoin est **refusé** en 7.3, la conduite à tenir est écrite : rejouer
`--mesurer-composants 7.2`, puis `7.1`, et redescendre les cinq définitions à la
version la plus haute acceptée. La parité rend l'opération indivisible.

## Ce que ça débloque, accessoirement

`ImageCarousel` est annoncé en **7.1+** — il était donc hors d'atteinte tant que
nous étions en 7.0, quel que soit le verdict de sa mesure. La migration ne le
rend pas disponible (il reste à mesurer), elle rend sa mesure **signifiante** :
en 7.0, un refus n'aurait rien appris.

## Ce qui reste ouvert

**La date de gel de 7.0 est inconnue**, et le restera tant que le journal des
changements de Meta sera inatteignable — HTTP 500 reproductible sur six
tentatives et quatre formes d'URL, archive web bloquée, les deux pages de
référence Flow JSON y renvoyant explicitement. Cette migration retire le risque
sans qu'on ait jamais pu lire l'échéance : c'est un choix de prudence, pas une
réponse à une date connue.
