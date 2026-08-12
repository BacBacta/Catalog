# 0034 — Le pidgin : écrit, et non servi

- Statut : accepté
- Date : 2026-08-02
- **Révise l'ADR 0033**, section « Les langues », sur un point et un seul :
  le pidgin passe de *non écrit* à *écrit et fermé*. Il ne devient pas servi.
- Concerne `apps/api/src/domain/bot/textes.ts`, `apps/api/src/bot.ts`,
  `apps/api/src/jobs/relance-acompte.ts`
- N'ajoute aucune dépendance, aucune colonne, aucune migration

## Contexte

L'ADR 0033 a laissé le pidgin de côté avec une raison juste :

> Le pidgin est reporté, pas oublié : l'écrire sans relecture par un locuteur
> reviendrait à inventer une langue plausible.

C'est le §7.7 d'`AGENTS.md` appliqué — *signaler plutôt que combler*. La
décision tient toujours. Mais « reporté » avait un effet secondaire que personne
n'avait pesé : **il laissait la page blanche**, et une page blanche ne se relit
pas. La relecture par une locutrice était posée comme préalable à l'écriture,
alors qu'une relecture a besoin d'un texte à relire. Le point ne pouvait donc pas
avancer d'un pas tant qu'on le formulait dans cet ordre.

## Décision

**Le catalogue pidgin est écrit. Il n'est servi à personne.**

Les deux moitiés comptent autant l'une que l'autre, et c'est toute la nuance de
cet ADR : le §7.7 n'interdit pas d'écrire un brouillon, il interdit de le
**promouvoir en silence**. Un brouillon nommé comme tel, injoignable, et dont
l'ouverture est une décision explicite n'est pas une valeur inventée qui se fait
passer pour une valeur constatée.

Concrètement :

- `Langue` gagne `"wes"` — le code ISO 639-3 du pidgin **camerounais**
  (Kamtok). Ce n'est pas `pcm`, qui désigne le pidgin nigérian : les deux se
  comprennent mais ne s'écrivent pas pareil ;
- `TEXTES.wes` est complet. La parité des clés est tenue par le typage
  (`Record<Langue, TextesAcheteuse>` ne compile pas s'il en manque une), celle
  du contenu par le balayage de `couverture.test.ts` ;
- `PIDGIN_RELU` vaut **`false`**, et c'est la seule valeur honnête aujourd'hui ;
- `LANGUES_SERVIES` en découle. `langueDemandee` reconnaît « pidgin », « kamtok »
  et « pidgin english » mais **ne les rend pas** tant que le drapeau est fermé.

## Pourquoi un drapeau dans le domaine, et pas une variable d'environnement

`src/domain` interdit `process.env` — c'est la règle du lot 7, tenue par un test
qui lit les sources. Ce n'est pas un obstacle contourné ici, c'est la bonne
réponse : **ouvrir une langue n'est pas un réglage d'exploitation.** Une variable
d'environnement se pose sur un serveur un vendredi soir sans que personne ne
relise rien. Une constante se change dans une revue, avec la case « une locutrice
a relu le catalogue » cochée devant témoin.

## La bascule ne peut pas être faite à moitié

Deux tests encadrent le passage à `true`, et ils échouent dans les deux sens :

- **rien ne sort tant que c'est fermé** — `langueDemandee` rend `null`, et
  `normaliserLangue` ramène au français une conversation persistée en `wes` ;
- **l'aide française et anglaise annonce la langue dès que c'est ouvert.** Ouvrir
  sans annoncer rendrait le pidgin introuvable : personne ne devine qu'il faut
  écrire « pidgin ». Annoncer sans ouvrir promettrait une langue que le bot
  refuse.

S'y ajoute le marquage exigé par le §7.7 — « dans le code **et** dans
l'interface ». Si quelqu'un ouvre la langue avant la relecture, `langueChangee`
le dit à l'acheteuse dès le premier message, avec le chemin de retour vers le
français ou l'anglais.

## Le garde qui manquait, et qui vaut au-delà du pidgin

`bot.ts` lisait `enregistrement?.langue === "en" ? "en" : "fr"`, et
`relance-acompte.ts` faisait `TEXTES[charge.langue] ?? TEXTES.fr`. Les deux
tenaient tant qu'il n'y avait que deux langues.

Le scénario qui les casse n'est pas l'inconnu, c'est le **connu refermé** :
quelqu'un ouvre le pidgin, des conversations s'écrivent en `wes`, puis on le
referme après relecture ratée. Ces conversations continueraient à recevoir un
brouillon, indéfiniment, parce que `TEXTES.wes` existe toujours.

D'où `normaliserLangue`, qui ne filtre pas sur ce que le type connaît mais sur
**ce qui est servi**. Les deux sites de lecture passent par elle.

## Ce que cet ADR ne fait pas

- **Il ne rouvre pas les deux autres points ouverts.** `product.variants` reste
  une colonne morte, et tout ce qui exige des gabarits utilitaires attend
  toujours le WABA. Ils sont inchangés.
- **Il ne traduit pas le fil vendeuse.** L'app vendeuse entière est en français ;
  une langue seule ne changerait rien à son expérience.
- **Il ne touche pas aux mots-clés.** « menu », « annuler », « suivi » restent
  les mêmes dans les trois langues, et l'aide pidgin les cite tels quels : ce
  sont des commandes, pas des phrases.

## Ce qu'il reste à faire, et par qui

**Une locutrice relit `TEXTES.wes` en entier, puis le drapeau passe à `true`.**
Trois points à lui soumettre en priorité, notés dans le code au-dessus du
catalogue :

1. **les libellés de boutons**, plafonnés à vingt caractères par WhatsApp —
   c'est la contrainte qui a le plus tordu les formulations, et un test la
   mesure pour les trois langues ;
2. **« how much »**, qui dit le prix et non la quantité. La question de quantité
   l'évite exprès, au prix d'une tournure peut-être lourde ;
3. **les emprunts français** — `kwata`, `farmasi`, `nomba` — plausibles à
   Douala, à confirmer.

Tant que cette relecture n'a pas eu lieu, l'état honnête du point est : *écrit,
relisible, fermé*. C'est un pas de plus que *reporté*, et un pas de moins que
*livré*. Les deux se disent.
