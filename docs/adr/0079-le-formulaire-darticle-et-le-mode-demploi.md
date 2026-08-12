# 0079 — Le formulaire d'article, et le mode d'emploi au premier article

- **Statut** : accepté
- **Date** : 12/08/2026
- **Répond à** : la demande du banc du 11/08/2026 — « un flow de création
  résoudrait ça. il faut aussi un onboarding pour expliquer simplement
  l'application. » (tâche #62)
- **Même famille que** : l'ADR 0063 (les trois formulaires) et la tâche #60
  (le formulaire d'inscription branché).

## a) Le formulaire de création d'article

Créer un article restait le geste le plus répété du fil vendeuse, et le seul
sans formulaire : trois questions (nom → prix → photo), ou la photo légendée
« nom prix ». Le quatrième Flow — `catalog_article` — met **nom, prix et
stock** dans un écran.

Les règles sont celles des trois premiers, sans exception :

- **Il s'ajoute aux questions, il ne les remplace pas.** Un Flow exige un
  WhatsApp récent ; la question marche partout. La question part en dernier —
  c'est elle qui reste visible si le formulaire échoue. Sans
  `WABOT_FLUX_ARTICLE_ID`, le fil est exactement celui d'avant.
- **Il publie par le même chemin que les questions.** L'effet de la machine et
  la réponse du formulaire passent tous deux par `publierArticleDepuisFil` —
  extrait de l'effet, non dupliqué. Annonce, reconstruction de la page web
  (ADR 0065), carte-vitrine au premier article (ADR 0037), pack statut à
  chaque publication (rang 3a) : une seule liste, un seul endroit.
- **Il refuse ce que la question refuse.** Nom de 2 à 80, prix par `lirePrix`.
  Le stock, lui, est TOLÉRANT : champ de confort (ADR 0038), une valeur
  illisible devient absente au lieu de faire échouer l'article — la même
  logique que la langue de l'inscription. Zéro vaut absent : c'est la
  convention de la base (« non annoncé »).
- **Son jeton le sépare des trois autres** (`article:`) — tous les formulaires
  arrivent par le même `nfm_reply` (ADR 0063).

### La photo n'y est pas, et c'est un point OUVERT

`PhotoPicker` n'a **jamais été mesuré** sur notre WABA. La méthode existe —
celle de la localisation : un formulaire jetable, on lit ce que Meta refuse
(addendum de l'ADR 0063). Tant que la mesure n'est pas faite, on ne suppose
rien (AGENTS.md §7.7) : la photo reste un envoi séparé, et la photo légendée
« nom prix » reste le geste le plus rapide du canal. Un test tient le point
ouvert : il échoue si quelqu'un ajoute un `PhotoPicker` à la définition sans
passer par la mesure.

La mesure se fera **au moment du dépôt** (`flux.mjs --deposer`), qui exige
`WABOT_API_KEY` — le même rendez-vous que pour le gabarit `paiement_conteste`.

### Une réponse tardive n'est pas perdue

Le formulaire reste ouvert sur le téléphone aussi longtemps que la vendeuse
veut — bien après l'expiration de l'état de conversation. Sans règle
d'aiguillage, sa réponse partait au fil acheteuse dès qu'un panier était
ouvert, et l'article se perdait. L'aiguillage reçoit donc `formulaireArticle`,
calculé par le service (le jeton vit dans la charge utile, que le module
d'aiguillage ne lit pas), et la réponse revient toujours au fil inscription.

## b) Le mode d'emploi — au premier article, pas à la création

Rien n'expliquait l'application à une vendeuse qui y arrivait. Ce qu'elle a
besoin de savoir tient en quatre lignes : les commandes arrivent dans le fil,
« livrée <référence> » marque la remise, le numéro Mobile Money la fait payer
d'avance, et sa boutique en ligne a une adresse à partager.

**Le moment choisi est la publication du premier article.** À la création de
la boutique, elle reçoit déjà trois messages ; un mode d'emploi s'y noierait.
Au premier article, la boutique devient montrable — c'est l'instant où la
première commande peut arriver, donc l'instant où « que se passe-t-il
maintenant ? » se pose. C'est le raisonnement de la carte-vitrine (ADR 0037),
appliqué au texte. Il part en dernier : c'est lui qui reste sous le pouce.

**Chaque ligne promet un geste qui existe** — « livrée », « ma boutique »,
« ajouter », « vendu », tous tenus par leurs lecteurs (`demandeRemise`,
`demandeEspaceVendeuse`, `demandeAjoutArticle`, `demandeComptoir`). Une ligne
d'aide qui promet un mot que le bot ne comprend pas est pire que pas d'aide.
Les liens sont un confort : sans `baseBoutique` ou `baseApp`, la phrase reste
vraie sans eux — on ne fabrique jamais une URL fausse.

Il dépendait de la tâche #47 (la boutique née dans le fil a une vraie page),
close : le lien qu'il donne ne mène plus à un 404.

## Ce qui reste ouvert

- **Le dépôt chez Meta** : `catalog_article` est écrit, validé hors ligne
  (`flux.mjs` vérifie que la définition promet ce que le domaine relit) et
  branché ; il n'est pas déposé. Sans dépôt, rien ne change au fil.
- **La mesure `PhotoPicker`**, au même rendez-vous.
- **`input-type: "number"`** sur prix et stock est une hypothèse raisonnable
  mais non déposée : si Meta la refuse, le dépôt échoue BRUYAMMENT et le champ
  repasse en `"text"` — aucun échec silencieux possible, la validation du
  dépôt précède la publication.
