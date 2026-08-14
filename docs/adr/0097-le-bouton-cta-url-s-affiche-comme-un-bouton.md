# ADR 0097 — le bouton `cta_url` s'affiche bien comme un bouton

Date : 14/08/2026
Statut : accepté — **verdict de mesure**
Prolonge : ADR 0087, 0088

## La réserve que cet ADR lève

L'ADR 0087 a mesuré `cta_url` le 13/08 et l'a déclaré **accepté** : le message
est parti, l'API a rendu un identifiant. Il a aussi écrit, honnêtement, ce que
cette mesure ne disait pas :

> L'API a **accepté** le message, ce qui règle la question du type. Que le
> bouton s'affiche comme un bouton chez l'acheteuse — et non comme un pavé de
> texte — se voit dans le fil, pas dans une réponse HTTP. La conversion des
> liens attend ce coup d'œil.

Le coup d'œil a eu lieu.

## Ce qui a été envoyé, et ce qui a été vu

Mesure rejouée le 14/08 (run 31793889872) vers le même numéro que le 13/08 —
il est encodé en clair dans le `wamid` que l'ADR 0087 a conservé, ce qui a
permis de vérifier la destination au lieu de la supposer.

La charge, telle que `composants.mjs` l'émet :

```json
{ "type": "interactive",
  "interactive": {
    "type": "cta_url",
    "body": { "text": "Mesure Catalog : ce bouton remplace-t-il une URL brute ?" },
    "action": { "name": "cta_url",
                "parameters": { "display_text": "Ouvrir la boutique",
                                "url": "https://catalog.cm" } } } }
```

Verdict de l'API : accepté, `wamid.HBgLMzI0NjY0NTcyODEVAgARGBI2Q0M1REIzNjg4QjI4QUJDNTUA`.

**Dans le fil**, la capture montre un vrai bouton : une zone tapable séparée du
corps du message par un filet, portant une icône de lien sortant et le libellé
`Ouvrir la boutique` rendu en entier. Ce n'est ni un pavé de texte, ni une URL
brute soulignée.

## Ce que ça autorise

**La conversion des liens bruts du fil en boutons devient un travail à faire,
plus une hypothèse à vérifier.** C'est la seule chose que cet ADR change.

## Ce que ça n'autorise pas

- **La frontière de l'ADR 0088 tient.** `cta_url` sert « **va voir** cette
  page ». Il ne sert jamais « **prends** cette décision » : une confirmation,
  une annulation, un choix de mode de livraison restent des boutons de réponse,
  pas des liens déguisés.
- **La forme ne porte qu'UN bouton.** `action.parameters` est un couple
  `display_text` / `url` unique. Un message qui doit offrir deux destinations
  n'est pas un `cta_url`, et cet ADR ne dit rien de ce qu'il faudrait à la
  place.
- **Le message doit rester autosuffisant en texte brut.** C'est une règle
  d'`AGENTS.md`, et elle vaut *plus* fort pour un bouton que pour un lien :
  certains acheteurs sont sur un forfait où les liens externes échouent. Un
  bouton qui ne s'ouvre pas ne doit jamais emporter avec lui la référence, le
  code de vérification ou le montant.

## Ce qui n'est pas mesuré

Un seul client a été observé — celui de ce téléphone-là. Le rendu sur iOS, sur
WhatsApp Desktop ou sur un Android ancien n'a pas été vu, et ne se déduit pas
d'une capture. Ce n'est pas bloquant : le repli est le texte du corps, qui
reste lisible partout. Mais si un jour un rendu surprend, la question aura été
posée ici plutôt que découverte à ce moment-là.
