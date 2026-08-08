# 0051 — Les mots du tunnel, et le numéro que le bot refusait de relire

Date : 2026-08-08
Statut : accepté
Lot B (seconde moitié) — `docs/analyses/2026-08-07-audit-integral-du-bot.md`

## Décision 1 — les mots de l'après-achat se taisent dans le tunnel

`reagirApresAchat` s'exécute **avant** le switch d'états, et lisait :

```ts
const veutContresigner = id === "contresigner" || tape === "confirmer";
```

Or « Confirmer » est le libellé écrit **sur le bouton** du récapitulatif
(`btnConfirmer`). Quelqu'un qui recopiait le mot au lieu d'appuyer perdait son
panier, son mode et sa livraison. Pire : avec une commande antérieure dans le
fil, il **contre-signait la mauvaise commande** — le contrôle n° 7 déclenché
sur autre chose que ce qu'il croyait valider.

En anglais le piège n'existait pas (« confirm » ≠ « confirmer ») : l'acheteuse
anglophone n'avait simplement **aucun** chemin tapé.

`dansLeTunnel` rend les mots — et eux seuls — inertes dans les six états qui
vont du choix d'un article à la création de la commande. **Les boutons restent
honorés partout** : leur identifiant est posé par nous, il ne se tape pas par
hasard.

## Décision 2 — et le récapitulatif accepte le mot tapé

Le mot cantonné, il devient sûr — et il faut alors l'accepter, pas le laisser
mort.

- **Le dépôt le fait déjà** : l'état `mode` accepte le bouton *ou* le mot
  (« livraison », « delivery », « retrait », « pickup »). Refuser au
  récapitulatif ce qu'on accepte à l'étape d'avant serait une incohérence.
- **Le mot est écrit sur le bouton.** Refuser ce qu'on affiche est le défaut
  que ce lot corrige par ailleurs, deux fois.
- **Les boutons ne s'affichent pas toujours** : vieux WhatsApp, message
  transféré, connexion dégradée. Taper est le repli naturel, et c'est la
  population qui en dépend le plus.
- **Le récapitulatif a déjà fait son travail** : articles, total, livraison
  sont sous les yeux. L'engagement est informé qu'elle tape ou qu'elle appuie.

Correspondance **exacte** après normalisation, jamais une sous-chaîne : « je ne
veux pas confirmer » ne confirme rien. Symétrique pour « corriger », lui aussi
écrit sur un bouton. Et « confirm » / « correct » pour l'anglaise.

## Décision 3 — le numéro se lit par la fin, sous toutes ses écritures

Le motif `([62]\d(?:\s*\d){7})` exigeait les deux premiers chiffres **collés**.
La forme que le bot affiche lui-même — `formatPhone` rendait `6 90 11 22 33` —
était donc refusée quand l'acheteuse la recopiait du récapitulatif. Elle
relisait, ne voyait pas la différence, recommençait.

L'espace est désormais libre partout entre les neuf chiffres, et les préfixes
`+237`, `237`, `00237` sont acceptés. L'**ancre de fin** fait le tri quand le
repère contient lui aussi des chiffres (« carrefour 2, 690 11 22 33 ») : seul
un groupe de neuf chiffres commençant par 6 ou 2 et terminant le message est
retenu.

## Décision 4 — l'affichage groupe l'opérateur : `690 11 22 33`

`formatPhone` rendait `6 90 11 22 33`. Le produit affiche désormais
`690 11 22 33`, pour trois raisons dans cet ordre :

1. **Les trois premiers chiffres nomment l'opérateur** — 69x Orange, 67x/68x
   MTN, 62x Nexttel — et l'opérateur décide de tout ici : le code USSD, les
   frais hors réseau, quel SMS fera preuve. `6 90` coupait cette information
   en deux.
2. **C'est déjà la convention dominante du dépôt** : douze exemples de copies
   FR et EN l'écrivent ainsi, contre une fonction.
3. **C'est la seule forme que la saisie acceptait** avant ce lot : aligner
   l'affichage ferme la boucle.

**Une précision d'honnêteté.** Le test qui gardait l'ancienne forme
s'intitulait « groupe les chiffres comme on dicte un numéro au Cameroun ».
Cette affirmation n'avait **aucune source** — ni ADR, ni note de terrain — et
l'entrée de ce test lui-même s'écrivait `237 677 12 34 56`, en groupes de
trois. Si le terrain dit l'inverse, c'est **une ligne à rendre**, et ce
paragraphe est là pour qu'on sache laquelle.

## Décision 5 — un vocabulaire commun aux trois fils

« menu », « aide », « panier » ne vivaient que dans le fil acheteuse. Une
vendeuse coincée dans un formulaire n'avait qu'un mot pour sortir — « annuler »
— et il n'était annoncé que dans une partie des messages.

`motCleGlobal` est exporté et honoré par l'inscription : « aide » dit **où on
en est** puis repose la question de l'état, « menu » met le formulaire de côté.
Ces mots priment sur la saisie — « aide » ne devient plus un nom d'article.

## Ce que ce lot ne fait PAS

- **L'aiguillage n'est pas touché.** La règle 1 (« une inscription en cours
  prime sur tout ») avale toujours un lien de boutique. C'est le lot C, et le
  mélanger ici aurait fait deux moitiés.
- **`extraireSlugBoutique` garde son motif non ancré.** La garde par état
  (`texteEstDuContenu`, ADR 0050) suffit à fermer les cas mesurés ; l'ancrage
  est une ceinture, elle viendra avec le lot C qui touche déjà ce chemin.

## Conséquences

- 909 tests API, 120 contrats, 90 boutique. 26 nouveaux, vus rouges d'abord.
- Le changement de `formatPhone` touche le reçu, la notification vendeuse, le
  bloc de paiement et l'écran d'attente de la rampe. C'est cosmétique : la
  vérifiabilité d'un reçu tient au code de vérification et à l'identifiant
  d'opérateur, jamais à l'espacement d'un numéro.
