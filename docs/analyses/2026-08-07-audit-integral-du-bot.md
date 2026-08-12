# Audit intégral du bot Catalog

*Audit conduit le 07/08/2026 sur le dépôt `/home/user/Catalog`. Toutes les citations sont vérifiées ligne à ligne dans le code présent sur la branche courante. Ce qui n'a pas pu être vérifié est marqué « à confirmer ».*

---

## 1. Le verdict en cinq lignes

Le bot n'est pas « halluciné » et n'est pas mal codé : c'est une machine à états déterministe, propre, testée, dont **chaque module pris isolément fait ce qui est écrit**. Ce qui est cassé, c'est la couche qui décide *quel* module reçoit un message — et le fait que la machine attend une saisie clavier là où le canal offre un bouton.

La cause racine est unique et tient en une phrase : **le bot possède un seul champ d'état par numéro de téléphone (`BotConversation.etat`), et un seul aiguilleur qui doit deviner à qui ce champ appartient**. De là découlent, mécaniquement, les cinq bloquants : une inscription en cours avale un lien de boutique (§2), un repère de livraison contenant le mot « boutique » détruit le panier (§4), le mot « confirmer » tapé au récapitulatif annule la commande (§4), une ville saisie « Yaoundé » rend une boutique incapable de vendre en livraison pour toujours (§3), et cinq formes de message entrantes sur onze — dont le vocal — ne produisent **aucune réponse du tout** (§3).

Ce qui n'est pas cassé, et qu'il faut protéger : le domaine est pur et testable (`apps/api/src/domain/bot/`, 4 996 lignes au total, aucune dépendance Prisma) ; le chemin « photo légendée → confirmation → publication » (`inscription.ts:388-403`) est excellent et doit servir de modèle à tout le reste ; le récapitulatif avant création (`conversation.ts:646-670`) est le seul garde-fou du produit contre une commande fausse et ne doit **jamais** être fusionné ; la file de notifications (`bot-notifications.ts:55-113`) ne perd rien.

**Le pipeline n'est pas à réécrire. Il est à re-router, et à convertir de la saisie vers le choix.**

---

## 2. Le défaut de structure : l'aiguillage avale tout

### 2.1 Le mécanisme, exactement

`apps/api/src/domain/bot/aiguillage.ts` est un module de 102 lignes qui décide vers quel fil part un message : `inscription`, `vendeuse` ou `acheteuse`. Son commentaire dit lui-même que **l'ordre des règles est le contrat**. La règle 1, lignes 56-59 :

```ts
/* 1. Une inscription commencee se termine. Rien ne la detourne — sinon un
   nom de boutique qui ressemble a un slug renverrait la personne au
   catalogue au milieu de son inscription. */
if (ctx.etatVendeuseEnCours) return "inscription";
```

`etatVendeuseEnCours` est vrai dès qu'un des six états vendeuse est posé : `inscription_nom`, `inscription_ville`, `article_nom`, `article_prix`, `article_photo`, `article_confirme` (`inscription.ts:37-50`).

Conséquence : quand une personne est en `article_prix` et qu'elle envoie **`boutique shopping`** — le geste d'achat le plus fondamental du produit, celui que le lien `wa.me` pré-remplit et que toutes les vendeuses mettent en Statut —, le message ne passe pas par la règle 4 (« l'achat », ligne 96). Il part au fil inscription, arrive dans `case "article_prix"` (`inscription.ts:424-436`), et `lirePrix("boutique shopping")` rend `null` faute de chiffre. Réponse envoyée :

> « Je n'ai pas compris le prix. Écrivez-le en chiffres, sans virgule.
> Exemple : 15000
>
> Pour sortir : tapez « annuler ». »

L'incident constaté en préproduction est la même famille : `Hi` en état `article_nom` a produit « **Hi** — son prix, en francs ? » (documenté dans l'ADR 0048, `docs/adr/0048-peremption-du-fil-vendeuse.md:9-13`).

### 2.2 L'ADR 0048 a traité l'horloge, pas la priorité

L'ADR 0048 a ajouté `etatVendeuseApresInactivite` (`inscription.ts:69-73`) qui annule un état vendeuse au-delà de `INACTIVITE_MAX_MS = 24 h` (`conversation.ts:223`). C'est correct et nécessaire. **Ce n'est pas suffisant** : le délai réel entre deux clientes, sur un étal, est de vingt minutes. À vingt minutes, la règle 1 s'applique intégralement.

### 2.3 L'ampleur : tous les gestes avalés

Voici ce que la règle 1 détourne aujourd'hui, pendant les 24 h d'un formulaire en cours. Chaque ligne a été vérifiée contre le code de `inscription.ts:331-497`.

| Geste envoyé | État vendeuse en cours | Ce que la personne reçoit |
|---|---|---|
| `boutique chez-amina` (lien wa.me) | `article_nom` | « **boutique chez-amina** — son prix, en francs ? » — 19 caractères, donc **nom d'article valide** (`inscription.ts:405-421`) |
| `boutique chez-amina` | `article_prix` | « Je n'ai pas compris le prix. » |
| `boutique chez-amina` | `inscription_ville` | La ville de la boutique devient « boutique chez-amina » (2-80 car., accepté, `inscription.ts:358-380`) |
| `livree CT-522801` | `article_prix` | Publie un prix de **522 801 F** — `lirePrix` colle tous les chiffres (`inscription.ts:190`) |
| Un SMS opérateur collé | n'importe lequel | `smsReconnu` n'est jamais consulté : la règle 3 est après la règle 1. Le SMS devient un nom ou un prix. |
| `congés` / `ma carte` / `solde` | `article_nom` | Deviennent des noms d'articles |
| `menu`, `panier`, `aide` | tous | Aucun effet : `motCleGlobal` (`conversation.ts:299-306`) n'existe **que** dans le fil acheteuse |
| Une photo | tous sauf `article_nom`/`article_photo` | Le `mediaId` est jeté sans un mot |

Un seul mot sort de ce piège : `annuler` / `stop` / `cancel` (`inscription.ts:319-329`), et il n'est annoncé que dans quatre messages sur douze (`SORTIE_DE_SECOURS`, `inscription.ts:221` — absent notamment de `inscription_ville` et de `article_photo`).

### 2.4 Le correctif exact

Trois gestes, dans cet ordre, tous dans `aiguillage.ts` et dans un nouvel écran d'arbitrage.

**(a) Une liste fermée de gestes traverse TOUJOURS un formulaire en cours.** Avant la règle 1, on teste, dans cet ordre :

1. `extraireSlugBoutique(t)` — un lien de boutique ;
2. `analyserSms(t).reconnu` — un SMS opérateur (le geste qui produit la preuve, valeur n°1) ;
3. une référence de commande `/\bCT-\d{6}\b/` ;
4. `motCleGlobal(t)` — `annuler`, `menu`, `aide`, `panier`.

Ces quatre-là sont **non ambigus** : aucun d'eux n'est une réponse plausible à « quel est le nom de l'article ? » ou « son prix, en francs ? ».

**(b) On n'avale pas, et on ne jette pas : on arbitre en une ligne à boutons.** Le formulaire en cours n'est pas détruit ; il est mis en pause et la personne choisit. Copie proposée, FR :

> « Vous étiez en train d'ajouter un article (*Pagne wax 6 yards*). On finit ça, ou on va voir la boutique **Chez Amina** ? »
> `[Finir l'article]` `[Voir la boutique]`

EN :

> « You were adding an item (*Pagne wax 6 yards*). Finish it, or open **Chez Amina**? »
> `[Finish the item]` `[Open the shop]`

Pour le SMS opérateur, aucun arbitrage n'est nécessaire : il part directement au fil vendeuse, l'état d'article est conservé, et le verdict de preuve est suivi d'un « on reprend votre article : son prix ? ». Un SMS collé est toujours prioritaire — c'est le seul signal de paiement que le produit possède (ADR 0025).

**(c) Le mot de sortie s'annonce partout.** `SORTIE_DE_SECOURS` (`inscription.ts:221`) doit être concaténé à **tous** les messages de relance des six états vendeuse, sans exception. Deux le portent aujourd'hui, deux ne le portent pas (`inscription.ts:364-367`, `inscription.ts:470-479`), et le message de `bot.ts:359-367` est une copie jumelle de `inscription.ts:412-414` **amputée de cette phrase** — deux versions du même texte dans le dépôt.

Coût estimé : environ 40 lignes dans `aiguillage.ts`, un champ optionnel `enPause` sur `EtatVendeuse`, deux copies FR/EN. Aucune dépendance WABA.

---

## 3. Le parcours VENDEUSE, tel qu'il est vécu

### 3.1 Mama Ngo, 42 ans, pagnes au marché de Mokolo, Yaoundé

Objectif : trois articles en ligne ce soir, entre deux clientes. Résultat : **56 tours de parole**, trois articles publiés, et trois dommages qu'elle ne peut réparer depuis WhatsApp.

**Le silence total (tour 5).** Elle envoie une note vocale de 9 secondes. `lireEntreesBot` (`entrees.ts:69-90`) ne pousse que `text`, `image` et `interactive`. Le commentaire ligne 91-92 assume l'omission : « *stickers, audios, accuses : ignores ici* ». Aucune entrée n'est produite, donc `traiterEntree` (`bot.ts:191`) n'est jamais appelé : **zéro message sortant, zéro accusé, pas même une coche bleue** (aucune occurrence de `status: "read"` ni de `typing_indicator` dans `apps/api/src` — grep vérifié, zéro résultat). Sur un canal où l'absence de réponse veut dire panne, et pour une personne qui dicte par défaut, c'est la sortie la plus fréquente du produit. La maquette validée promet pourtant l'inverse (`docs/maquettes/bot-cible.html:250` : « La note vocale — **LE geste du terrain** »).

**La bombe à retardement (tour 13).** À « *Dans quelle ville vendez-vous ? Exemple : Douala* », elle répond « Yaoundé ». `inscription.ts:358-380` accepte tout texte de 2 à 80 caractères. `bot.ts:539` stocke `city: demande.ville` brut. Puis, à chaque commande d'acheteuse, `conversation.ts:1068` injecte cette valeur en silence :

```ts
livraison: { mode: "livraison", city: villeBoutique, quartier, landmark, phone }
```

Et `packages/contracts/src/delivery.ts:62` la valide contre :

```ts
city: z.enum(["Douala", "Yaounde"]),
```

« Yaoundé » ≠ « Yaounde ». Chacune de ses acheteuses fera neuf tours, appuiera sur Confirmer, et lira « **Cette commande n'a pas pu être enregistrée. Reprenez au catalogue — rien n'a été perdu.** » (`textes.ts:262-263`), indéfiniment. Le mode « Point de retrait » passe (pas de champ `city`) : le symptôme observable sera « la livraison ne marche jamais, le retrait oui ». Aucun écran, aucun mot-clé du fil vendeuse n'affiche ni ne corrige la ville.

Le même schéma frappe toute boutique hors de ces deux villes : Bafoussam, Bamenda, Garoua, Kribi, Buea, Limbé, Douala en minuscules.

**Le prix fabriqué (tour 23).** À « son prix, en francs ? », elle répond « 15 000 f les 6 yards ». `lirePrix` (`inscription.ts:189-195`) fait `texteBrut.replace(/[^\d]/g, "")` : tous les chiffres du message sont concaténés. Résultat publié : **150 006 FCFA**. Incohérence interne : `lireLegendeArticle` (`inscription.ts:206-216`) ne prend, elle, que le **dernier** groupe de chiffres. Et `reagirVendeuse` (`conversation.ts:1223-1362`) n'a **aucun** mot-clé de correction — ni « prix », ni « corriger », ni « supprimer ». Pire : la carte-vitrine part automatiquement au premier article (`bot.ts:406-413`), avec 150 006 FCFA gravé dans l'image que le produit lui demande de mettre en Statut WhatsApp.

**Les photos jetées (tours 11, 19, 38).** Trois photos envoyées, trois fois perdues, trois fois sans un mot sur la photo : le `mediaId` n'est mémorisé nulle part hors de `article_nom` avec légende lisible. À ~850 Ko l'envoi, cela fait environ **2,5 Mo de forfait payés pour rien** sur un forfait de 100 Mo.

**L'entonnoir sans porte (tour 2).** Elle est sur la boutique de sa cousine et cherche à ouvrir la sienne. `accueilBoutique` (`conversation.ts:916-943`) construit exactement trois boutons : `catalogue`, `photos`, `vendeuse`. Le bouton « Vendre avec Catalog » (`textes.ts:176`) n'existe **que** dans la branche sans boutique (`conversation.ts:443-446`). Or le lien qui circule réellement est le lien de boutique — c'est celui que le produit apprend à mettre en Statut (`inscription.ts:250`). Sans un appel téléphonique de sa cousine lui dictant le mot « vendre », Mama Ngo n'ouvre jamais sa boutique. Et le parrainage (`bot.ts:510-515`) n'est jamais crédité.

**Le menu-pavé.** Tout mot non reconnu retombe sur le menu vendeuse complet (`conversation.ts:1317-1359`), ré-imprimé intégralement : dix lignes, deux URL nues, trois boutons. C'est le fallback universel.

### 3.2 Brenda, vendeuse installée, région anglophone

Deux défauts la concernent en propre.

**L'anglais existe et n'est jamais proposé.** `TEXTES.en` est complet (`textes.ts:340-518`). L'offre de bascule n'apparaît qu'en fin de `aideGestes` (`textes.ts:178`, « *Write « english » for English.* ») et dans `langueChangee`. Ni l'accueil, ni la liste, ni la fiche, ni le récap ne la mentionnent. Et `langueDemandee` (`textes.ts:509-517`) n'accepte que quatre libellés en égalité stricte : « en », « english please », « pidgin » ne font rien. Une acheteuse du Nord-Ouest doit deviner le mot **français** « aide » pour découvrir une phrase anglaise cachée en fin de paragraphe.

**Sa fenêtre de service se ferme alors qu'elle parle.** `filVendeuse` (`bot.ts:1356-1465`) n'écrit **jamais** dans `botConversation` : les deux seuls `upsert` du dépôt sont `bot.ts:474` (via `poserEtat`, appelé uniquement par `filInscription` aux lignes 350, 360, 417) et `bot.ts:844` (fin de `filAcheteuse`). Donc « solde », « livrée CT-… », « ma carte » et **le collage d'un SMS opérateur** ne rafraîchissent pas `updatedAt`. Or `decisionRemise` (`domain/bot/notifications.ts:25-29`) juge la fenêtre de 24 h sur ce même `updatedAt`. Une vendeuse très active côté vendeuse voit ses notifications partir en file d'attente alors que sa fenêtre est ouverte. Ce n'est pas d'abord un défaut d'ergonomie : **c'est un défaut de facturation**, parce que le jour du WABA on paiera un gabarit sur une fenêtre gratuite.

### 3.3 Tableau : geste → tours aujourd'hui → tours cible

| Geste vendeuse | Aujourd'hui | Cible | Ce qui fait le gain |
|---|---|---|---|
| Ouvrir sa boutique depuis le lien d'une consœur | ∞ (impossible sans être coachée) | 3 | Bouton « Vendre avec Catalog » à l'accueil boutique, portant le parrain |
| Ouvrir sa boutique (mot « vendre » connu) | 5 | 3 | Ville en **liste**, pas en texte libre |
| Publier un article, photo légendée | 2 | 2 | *Déjà excellent — ne rien toucher* |
| Publier un article, photo sans légende | 5 (et 1 photo perdue) | 3 | Garder le `mediaId`, accuser la photo |
| Corriger le prix d'un article publié | ∞ (impossible) | 2 | Mot-clé « prix » + liste des articles |
| Envoyer un vocal | ∞ (silence) | 1 | Accuser la forme non lue, avec les boutons de l'état |
| Marquer une commande livrée | 1 | 1 | *Déjà bon* |

---

## 4. Le parcours ACHETEUSE, tel qu'il est vécu

### 4.1 Sandrine, du lien reçu au reçu vérifiable

Cas médian mesuré transition par transition dans `reagirAcheteuse` (`conversation.ts:379-707`) : un article, quantité 1, mode livraison, acompte attendu, boutique dont la ville passe l'enum.

| # | Elle envoie | Le bot répond | Msg |
|---|---|---|---|
| 1 | `boutique chez-amina` | `accueilBoutique` (`:916-943`) | 1 |
| 2 | bouton *Voir les articles* | `pageCatalogue` (`:945-986`) | 1 |
| 3 | ligne `art:<id>` | fiche article (`:988-1031`) | **2** (image + boutons) |
| 4 | bouton *Commander* | `questionQuantite` (`:845-860`) | 1 |
| 5 | bouton *1* | `messageAjout` (`:892-900`) | 1 |
| 6 | bouton *Passer commande* | `questionMode` (`:902-909`) | 1 |
| 7 | bouton *Livraison* | question livraison, **texte nu** | 1 |
| 8 | **saisie clavier** « quartier, repère, numéro » | `messageRecap` (`:1085-1112`) | 1 |
| 9 | bouton *Confirmer* | `confirmationCommande` (`:1136-1196`) | **4** |
| — | *(elle sort de WhatsApp et paie)* | — | 0 |
| — | — | `notifPaiementProuve` + 2 boutons | 1 |
| 10 | bouton *Contresigner* | `contresigneMerci` | 1 |

**La métrique reine : 10 tours de parole, 25 messages échangés, dont 15 sortants — pour acheter un seul article.** Une saisie clavier obligatoire. Une rafale finale de 4 messages portant **3 URL nues différentes** (`preview_url` figé à `false`, `messages.ts:131`), exactement au moment où elle doit quitter WhatsApp.

### 4.2 Les cinq façons dont ce parcours casse

**(a) « confirmer » tapé au récapitulatif détruit la commande.** `conversation.ts:427-428` appelle `reagirApresAchat` **avant** le switch d'états. Dans cette fonction, ligne 746 :

```ts
const veutContresigner = id === "contresigner" || tape === "confirmer";
```

Sans commande antérieure dans le fil, lignes 761-763 renvoient `{ etat: ETAT_INITIAL, … apresAchatSansCommande }` — soit « **Aucune commande enregistrée sur ce numéro. Ouvrez le lien d'une boutique pour commander.** » Panier, mode et livraison perdus. Le mot tapé est celui écrit **sur le bouton** (`btnConfirmer: "Confirmer"`). Pire cas : avec une commande antérieure dans le fil, « confirmer » **contre-signe la mauvaise commande** — le contrôle n°7 déclenché sur autre chose. En anglais le piège n'existe pas (« confirm » ≠ « confirmer ») : l'incohérence est aussi entre les deux langues. Même piège pour « avis », « noter », « review » (ligne 748).

**(b) Un repère qui contient le mot « boutique » détruit le panier.** `conversation.ts:404-407`, exécuté avant le switch, avec `extraireSlugBoutique` (`:283-289`) qui cherche `/boutique\s+([a-z0-9][a-z0-9-]*)/` **n'importe où** dans le texte. Vérifié : « Bonapriso, en face de la boutique Bata, 690 11 22 33 » → slug `bata` → boutique introuvable → `ETAT_INITIAL`, panier + livraison effacés, message texte nu sans bouton. « En face de la boutique X » est **la** façon camerounaise de donner un repère.

**(c) Le format de numéro que le bot affiche est refusé quand elle le saisit.** Saisie : `conversation.ts:1046` exige `([62]\d(?:\s*\d){7})` — les deux premiers chiffres collés. Affichage : `packages/contracts/src/phone.ts` produit « 6 90 11 22 33 ». Le récapitulatif affiche donc un format que le champ refuse. Réponse reçue : « Il me manque le numéro à appeler, à la fin du message. » Elle relit, ne voit rien, recommence : boucle.

**(d) Le code USSD affiché est celui de la mauvaise personne — et c'est un défaut d'argent.** `bot.ts:747-750` lit `charge.reversement.operateur`, l'opérateur de la **vendeuse**, puis ligne 754 pose `codeEntree: operateur?.codeEntree.modele`. Et `textes.ts:291-296` l'écrit comme une consigne à l'**acheteuse** : « **Composez #150\*50#, puis suivez le menu de transfert d'argent.** » En pays double SIM, c'est faux pour environ la moitié des acheteuses. Le dépôt se contredit par écrit : `apps/shop/src/islands/rampe/ChoixOperateur.tsx:5-8` dit « **C'est l'operateur de l'ACHETEUSE qui compte**, pas celui de la vendeuse ». Les deux codes d'entrée sont `verifie: true` dans `apps/api/src/domain/ramp/config.ts:81` et `:106` — seuls les raccourcis sont non vérifiés. Il faut afficher **les deux**, étiquetés par le portefeuille de l'acheteuse.

**(e) Le lien `/payer` est amputé de trois paramètres que la page sait lire.** `bot.ts:757-761` ne construit que `?numero=…&montant=…`. Or `apps/shop/src/islands/Payer.tsx:52-66` lit déjà `boutique`, `whatsapp` et `ref`, et `apps/shop/src/islands/rampe/Attente.tsx:31-40` n'affiche le lien « prévenir la vendeuse » **que si `whatsapp` est présent**. Capacité construite, testée, jamais alimentée — exactement au maillon qui déclenche la chaîne de preuve.

### 4.3 Les autres frictions majeures, en bref

- **Aucune sortie vers la vendeuse pendant tout le tunnel.** Le bouton `vendeuse` n'existe qu'à l'accueil (`:936`), en congés (`:1010`), en réponse FAQ (`:571`) et sur catalogue vide (`:957`). Les états `quantite`, `mode`, `details`, `recap` ne le proposent jamais. L'invariant produit d'AGENTS.md §1 — « l'acheteuse et la vendeuse continuent de se parler » — est suspendu pendant les six tours les plus décisifs.
- **Les questions libres ne sont écoutées que dans 2 états sur 8.** `conversation.ts:559` : `if ((etat.nom === "accueil" || etat.nom === "catalogue") && …)`. La réponse préparée `faqVariante` (« Tailles, couleurs et modèles se précisent directement avec la vendeuse ») ne partira jamais si la question arrive à l'étape quantité.
- **L'état quantité n'a aucune sortie au bouton dès que le stock permet 3.** `conversation.ts:851-858` : « Annuler » ne s'affiche que si `max` vaut exactement 2. Stock non suivi = `max` 99 = trois boutons `[1] [2] [Un autre nombre]` et pas un retour ; « Un autre nombre » renvoie un texte **sans aucun bouton**.
- **« Corriger » ne corrige rien.** `conversation.ts:684-690` renvoie à l'état `ajout` et abandonne la livraison saisie. Corriger un chiffre coûte trois tours et une re-saisie complète.
- **Le panier expire à 24 h en silence** (`conversation.ts:223-235`), alors que le changement de boutique, lui, le dit (`textes.ts:287`).
- **Le lien de suivi n'est jamais redonné** : « **Votre lien de suivi est dans le message de confirmation, plus haut dans ce fil.** » (`textes.ts:270-271`). Personne ne remonte un fil WhatsApp de deux cents messages sur un téléphone lent. La valeur n°1 du produit devient introuvable au moment du litige.
- **Une erreur serveur produit un silence complet.** `bot.ts:209-214` journalise et n'envoie rien. AGENTS.md exige quatre états par écran, dont « erreur » et « hors ligne » : le bot en a deux.
- **La rafale photo engage jusqu'à 600 Ko sur un appui** (`RAFALE_MAX = 6` × `CIBLE_OCTETS = 100 000`), et l'en-tête image de l'accueil est re-signé à chaque passage (`bot.ts:1187-1196`, `urlSignee(cle, 600)`) donc jamais mis en cache. Le libellé « Voir en photos » ne prévient de rien.

---

## 5. Le mal commun : une machine qui fait DEVINER au lieu de faire CHOISIR

Le fond du problème d'expérience se chiffre.

**Le bot possède 14 états** : 8 dans la machine acheteuse (`conversation.ts:117-137`) et 6 dans la machine vendeuse (`inscription.ts:37-50`).

**Dans 6 de ces 14 états (43 %), une saisie clavier est le seul chemin pour avancer :**

| État | Fichier | Ce qu'il exige |
|---|---|---|
| `details` | `conversation.ts:646-670` | quartier + virgule + repère ≥ 5 car. + numéro en fin, **en un seul message** |
| `quantite` (si `max ≥ 3`) | `conversation.ts:579-610` | un entier tapé — les boutons ne couvrent que 1 et 2 |
| `inscription_nom` | `inscription.ts:332-352` | texte |
| `inscription_ville` | `inscription.ts:358-380` | texte |
| `article_nom` | `inscription.ts:405-421` | texte |
| `article_prix` | `inscription.ts:424-436` | texte |

**Dans 5 de ces 14 états (36 %), le bot n'envoie JAMAIS un seul bouton**, dans aucune de ses branches : `details`, `inscription_nom`, `inscription_ville`, `article_nom`, `article_prix`. À cela s'ajoute une quinzaine de messages sans état propre également rendus en texte nu (`messageStatut`, `parlerVendeuse`, `panierVide`, `quantiteIncomprise`, `quantiteTropHaute`, `quantiteAutre`, `boutiqueIntrouvable`, `langueChangee`, les trois aides de livraison, `contresigneImpossible`, `avisImpossible`, `avisDejaDepose`, `apresAchatSansCommande`, `annule`).

**Sur ces 6 états à saisie obligatoire, 3 pourraient être des choix fermés dès aujourd'hui, sans le WABA :**

1. `quantite` → une **liste** de 1 à 8 + « Un autre nombre » + « Retour » = 9 lignes sur les 10 permises. Le constructeur `liste()` existe (`messages.ts:203-238`) et n'a que deux appelants.
2. `inscription_ville` → une liste de villes. C'est aussi le correctif du bloquant `city`.
3. le quartier dans `details` → `QUARTIERS` existe déjà dans `packages/contracts/src/delivery.ts:17-48` — **14 quartiers pour Douala, 12 pour Yaoundé, et cette constante n'est consultée nulle part dans le bot.** 26 valeurs prêtes à l'emploi, jamais utilisées.

Les trois autres (`inscription_nom`, `article_nom`, `article_prix`) sont légitimement du texte libre — mais `article_prix` doit cesser de **deviner** : `lirePrix` colle tous les chiffres alors que `lireLegendeArticle` prend le dernier groupe. La règle du §7.7 d'AGENTS.md (« on confirme l'extrait, on ne devine pas ») est appliquée dans un module et pas dans l'autre.

**Un défaut technique aggrave tout cela et doit être corrigé avant d'empiler du contenu dans les corps interactifs** : `messages.ts:15` fixe `CORPS_MAX = 4096`, et `corpsOuLeve` tronque silencieusement à cette valeur. Or 4 096 est la limite d'un message **texte** ; la limite Meta d'un **corps interactif** (boutons ou liste) est de **1 024**. Un corps entre 1 025 et 4 096 passe la validation locale et meurt en HTTP 400 à l'envoi, sans message pour personne. Le menu vendeuse mesure environ 600 caractères ; une fiche article à longue description peut dépasser 1 400. Le correctif est de séparer `CORPS_TEXTE_MAX = 4096` de `CORPS_INTERACTIF_MAX = 1024`.

---

## 6. Ce que le WABA débloque, outil par outil

**Prérequis à dire en tête de section** : `docs/runbooks/bascule-waba-production.md:8-24` établit que la bascule du 05/08/2026 n'a pas abouti et que **le blocage est administratif** — la vérification d'entreprise Meta est en attente, et « *aucun numéro ne peut être enregistré ou utilisé* » tant qu'elle ne passe pas. L'adaptateur d'envoi est dormant : sans `WABOT_API_KEY`, rien n'est monté (`apps/api/src/server.ts:92-101`). **Aucune date ne nous appartient.** Tout ce qui est marqué « fenêtre libre » ci-dessous est en revanche construisible immédiatement.

| Outil | Friction résolue | Coût | Effort | Verdict Cameroun |
|---|---|---|---|---|
| **Boutons de réponse** (`interactive.button`) — construit, `messages.ts:166-201` | 3 boutons max, ≤ 20 car., corps **1024** (le code croit 4096) ; footer 60 car. jamais construit | gratuit | petit | Meilleure forme du canal. Après 3 échanges les boutons sortent de l'écran : toujours doubler par un mot-clé écrit |
| **Listes** (`interactive.list`) — construit, `messages.ts:203-238` | quantité, quartiers, villes, notes d'avis. 10 lignes **au total**, titre 24, description 72 | gratuit | petit | Excellent : rendu local, zéro octet, se parcourt au pouce. 24 car. tombent vite sur un nom d'article |
| **Bouton-lien** (`cta_url`) — absent | les 5 URL nues du produit (payer, suivi, wa.me, reversement, parrainage) | gratuit | moyen | Utile, **mais** : http/https seulement. Le lien `tel:` qui porte la chaîne USSD **ne peut pas** y entrer. Et il exclut les boutons de réponse du même message |
| **Réactions** (`type: reaction`) — construit, `messages.ts:135-144` | l'accusé sans bulle supplémentaire | gratuit | petit | Idéal. **Contre-emploi à corriger** : le ✅ posé sur le SMS collé (`conversation.ts:1237`) se lit « validé » alors que rien n'est vérifié — remplacer par 👀 |
| **Citations** (`context.message_id`) — construit, **un seul appelant** | rattacher un verdict au SMS cité, des mois plus tard | gratuit | petit | Très bon sur écran étroit. Le repli `sansCitation` existe (`bot.ts:456-464`) |
| **Accusé de lecture + indicateur de frappe** — absents (grep : zéro) | les 5 formes entrantes silencieuses ; l'attente pendant le ré-encodage d'image | gratuit | petit | **Le meilleur rapport valeur/effort du document.** Zéro octet, zéro bulle, signal de vie immédiat |
| **vCard** (`type: contacts`) — absente | « Parler à la vendeuse » part en URL `wa.me` de 80 caractères illisibles | gratuit | petit | Très bon : le numéro enregistré survit à la conversation. C'est ce que la maquette validée décrit (`bot-cible.html:262`) |
| **Demande de localisation** (`location_request_message`) — absente | une des trois saisies de livraison | gratuit | moyen | Utile **mais** : GPS souvent coupé, imprécis en intérieur. Le repère reste obligatoire (ADR 0005). **Et il faut d'abord apprendre à lire `type: "location"` en entrée**, sinon on fabrique un silence de plus |
| **Reçu-image** (`type: image`) — chaîne déjà écrite | la valeur n°1 n'existe aujourd'hui que comme phrase + lien perdu dans le fil | gratuit | moyen | **Le plus fort du lot.** `carte-vitrine.ts` fait déjà SVG + QR + ré-encodage sous 100 Ko. Un reçu-image à QR vers `/v/?c=<code>` circule aussi bien que la fausse capture qu'il tue |
| **Aperçu de lien** (`preview_url`) — figé à `false`, `messages.ts:131` | les URL nues ressemblent à du spam | gratuit | petit | **Nuancé** : l'aperçu est téléchargé par SON téléphone. Et `apps/shop/src` ne porte aucune balise Open Graph — l'aperçu serait vide |
| **Flows** (`interactive.flow`) — absent | inscription et livraison en un écran | gratuit à l'envoi, **exige le WABA** pour publier le Flow | grand | Réel, mais classé 🟣 WABA par la maquette validée (`bot-cible.html:232`) et par CLAUDE.md. **À spécifier, pas à planifier** |
| **Bouton « appeler »** natif en fenêtre libre | — | — | — | **N'existe pas.** Le bouton `PHONE_NUMBER` est réservé aux gabarits, et la Business Calling API ferait sonner le WABA de Catalog, jamais la vendeuse (ADR 0034). **Ne pas ouvrir ce chantier** — la vCard est le substitut |
| **`address_message`** | — | — | — | **À écarter définitivement.** Réservé à l'Inde et Singapour, et il modélise un pays où l'adresse existe : interdit par AGENTS.md et l'ADR 0005 |

Note de dossier : l'ADR 0035:117-118 range les réactions et la vCard parmi ce qui « exige un gabarit ou le WABA ». **C'est inexact** : ce sont des messages de service ordinaires, envoyables en fenêtre libre — le code a d'ailleurs déjà implémenté les réactions. Ce point mérite une note dans le prochain ADR.

---

## 7. Les gabarits à soumettre MAINTENANT

Contraintes Meta appliquées : corps ≤ 1 024 caractères, pas de variable en tout début ni en toute fin de corps, jamais deux variables consécutives, libellé de bouton court (je tiens 20 caractères, marge sûre). Catégories : `UTILITY` pour ce qui suit une transaction initiée par l'utilisatrice, `MARKETING` pour le reste. **Réserve : la soumission au Hub 360dialog suppose un WABA existant ; qu'elle soit acceptée pendant que la vérification d'entreprise est « Pending » est à confirmer auprès du support.**

Cinq gabarits, dans l'ordre de valeur.

---

**1. `commande_nouvelle_vendeuse` — UTILITY — destinataire : la vendeuse**

> FR : 🛍️ *Nouvelle commande {{1}}*
> {{2}}
> Total : *{{3}}*
> Acompte attendu : *{{4}}*. Un SMS de votre opérateur devrait arriver — collez-le ici, il devient le reçu.
> Numéro à appeler pour la remise : {{5}}

> EN : 🛍️ *New order {{1}}*
> {{2}}
> Total: *{{3}}*
> Deposit expected: *{{4}}*. Your operator's SMS should arrive — paste it here, it becomes the receipt.
> Number to call for handover: {{5}}

Variables : {{1}} référence `CT-522801` · {{2}} lignes de commande · {{3}} total formaté · {{4}} acompte formaté · {{5}} téléphone de livraison formaté.
Boutons : aucun (le collage du SMS est du texte libre, un bouton n'apporte rien).

---

**2. `paiement_prouve_acheteuse` — UTILITY — destinataire : l'acheteuse**

> FR : ✅ *Votre paiement sur {{1}} est prouvé* — le reçu vérifiable est émis.
> Reste à payer à la remise : {{2}}
> Le reçu porte le code {{3}} : n'importe qui peut le vérifier, ce n'est pas une capture d'écran.

> EN : ✅ *Your payment on {{1}} is proven* — the verifiable receipt is issued.
> Left to pay on handover: {{2}}
> The receipt carries code {{3}}: anyone can check it, this is not a screenshot.

Variables : {{1}} référence · {{2}} solde formaté (ou « rien ») · {{3}} `verification_code`.
Boutons : `[Voir mon reçu]` en `URL` vers `https://…/v/?c={{1}}` — **la forme `/v/?c=<code>` est celle dont le produit dépend** (ADR 0021), pas `/v/<code>`. Plus `[Confirmer la réception]` en réponse rapide (contrôle n°7).

---

**3. `commande_livree_avis` — UTILITY — destinataire : l'acheteuse**

> FR : 📦 *{{1}} est marquée livrée* par {{2}}.
> Un mot sur la boutique ? Votre avis sera marqué *achat vérifié* — parce que votre paiement a laissé une trace.

> EN : 📦 *{{1}} has been marked delivered* by {{2}}.
> A word about the shop? Your review will be marked *verified purchase* — because your payment left a trace.

Variables : {{1}} référence · {{2}} nom de la boutique.
Boutons : `[Donner mon avis]` / `[Give my review]`, réponse rapide `avis`.

---

**4. `relance_acompte` — UTILITY — destinataire : l'acheteuse**

> FR : Votre commande {{1}} attend son acompte de *{{2}}* pour être confirmée.
> Sans acompte, elle expirera d'elle-même. Votre code secret se tape uniquement sur l'écran de votre opérateur — jamais ici.

> EN : Your order {{1}} is waiting for its *{{2}}* deposit to be confirmed.
> Without it, the order will expire on its own. Your PIN is typed only on your operator's screen — never here.

Variables : {{1}} référence · {{2}} acompte formaté.
Boutons : `[Payer maintenant]` en `URL` vers `/payer?…` — **avec les cinq paramètres**, pas deux (cf. §4.2e).

---

**5. `reversement_manquant` — MARKETING — destinataire : la vendeuse**

Ce gabarit est `MARKETING` et non `UTILITY` : il n'est pas déclenché par une transaction de la destinataire. Le classer `UTILITY` serait un risque de rejet, puis de dégradation de la note qualité du numéro — et ce numéro sert **toutes** les boutiques (ADR 0034).

> FR : {{1}}, il manque une chose à votre boutique pour encaisser d'avance : votre numéro Mobile Money.
> Il a sa propre vérification — c'est le numéro qui reçoit votre argent. Sans lui, vos clientes commandent sans acompte, donc sans SMS, donc sans reçu vérifiable.

> EN : {{1}}, one thing is missing for your shop to take payment upfront: your Mobile Money number.
> It has its own verification — it is the number that receives your money. Without it, customers order with no deposit, so no SMS, so no verifiable receipt.

Variables : {{1}} nom de la boutique.
Boutons : `[Ouvrir mes réglages]` en `URL`, et `[Ne plus me le dire]` en réponse rapide — **l'opt-out n'est pas une politesse, c'est ce qui protège la note qualité du numéro partagé.**

---

## 8. Basique et Premium : la recommandation

### 8.1 La recommandation, en une phrase

**Le discriminant est l'INITIATIVE, jamais le volume, et jamais la preuve.** Le palier gratuit ne perd jamais une information : elle est mise en file et remise à la prochaine interaction — c'est déjà le code (`bot-notifications.ts:55-113`). Le palier payant supprime le **délai**.

Cette frontière n'est pas choisie par confort commercial. Elle épouse exactement la seule ligne de coût variable du produit — Meta facture au gabarit délivré hors de la fenêtre de 24 h — et le seul geste qu'aucune diligence de vendeuse ne remplace : **on ne peut pas écrire au bot pour ouvrir une fenêtre dont on ignore l'existence.** C'est ce qui rend la limite non contournable, là où un quota d'articles se contourne en renvoyant la photo soi-même.

Et elle existe déjà en code, pure et testable : `decisionRemise(dernierMessageA, maintenant)` (`domain/bot/notifications.ts:25-29`), avec `FENETRE_SERVICE_MS = 24 h` (ligne 15).

### 8.2 Les paliers

| | **Basique — 0 F** | **Catalog — 2 500 F / mois** |
|---|---|---|
| **La phrase** | « Catalog **répond**. » | « Catalog **prévient**. » |
| **Inclus** | Boutique, catalogue, panier, commande, rampe de paiement, **les sept contrôles**, le reçu vérifiable, la contre-signature, l'avis vérifié, la carte-vitrine, le mode congés, le suivi. Notifications **en file**, remises à la prochaine interaction. | Tout Basique, **plus** : notification poussée hors fenêtre (nouvelle commande, paiement prouvé, livraison), relance de solde, digest du matin, relances de réachat consenties. |
| **Exclu** | Rien qui touche la preuve. Seul le **délai** de remise change. | — |
| **La raison non contournable de payer** | — | Une commande arrivée à 21 h un vendredi n'est pas remise avant qu'elle réécrive. Elle **ne peut pas** provoquer l'ouverture de la fenêtre. |

**Je n'ai pas de troisième palier à recommander aujourd'hui.** Le « numéro dédié sous le WABA Catalog » (ADR 0035:24-25) est une bonne idée, mais son prix dépend d'une licence de plateforme par numéro dont **le montant n'existe nulle part dans le dépôt** — je l'ai cherché : `docs/analyses/2026-08-02-parcours-vendeuse-acheteuse.md:351` dit seulement « coût réel par numéro (hébergement BSP) → c'est un palier d'abonnement ». Inventer un ordre de grandeur ici violerait AGENTS.md §7.7. C'est une question au porteur (§11).

### 8.3 La tension « brider la preuve détruit le produit » — comment je la tranche

**Tout ce qui construit le registre partagé est gratuit et n'a pas de version dégradée.** Pas de filigrane « offert par Catalog » sur un reçu, pas de délai, pas de reçu au rabais. Un reçu à deux régimes n'est plus opposable, donc n'est plus un reçu.

La raison n'est pas morale, elle est structurelle : le contrôle n°5 est une contrainte `UNIQUE (operator, operator_tx_id)` **réseau-large** (AGENTS.md §2). Le registre vaut ce que vaut sa couverture. Mettre un péage sur ce qui alimente le registre, c'est vendre plus cher un produit moins fiable.

**Le trou que cela ouvre, et comment je le ferme.** Les gabarits vers l'**acheteuse** (paiement prouvé, livraison, relance d'acompte) sont une charge nette du palier gratuit. Une boutique gratuite à 300 ventes par mois coûterait plusieurs centaines de gabarits pour 0 F de revenu. Je ferme par deux clauses, pas par une :

1. Ces gabarits acheteuse ne se déclenchent **que sur un événement qui a déjà de la valeur** : un paiement prouvé, une livraison marquée, une commande créée en attente d'acompte. Une boutique qui génère du coût est, par construction, une boutique qui vend — donc la meilleure cible de conversion qui existe.
2. Un **plafond mensuel DIT**, calibré haut, affiché dans l'app vendeuse et dans le fil. Au-delà, la notification ne disparaît pas : elle **retombe en file**. C'est exactement le discriminant du modèle (délai, jamais perte), appliqué à lui-même. **On ne découvre jamais un plafond sur une facture.**

### 8.4 La règle de dégradation

Calquée sur le mode congés (ADR 0039, `docs/adr/0039-mode-conges.md:112-114`) : un abonnement `past_due` ou `cancelled` **ne coupe rien en cours**. Les commandes déjà ouvertes vont jusqu'au bout, notifications comprises. Seules les commandes **nouvelles** retombent en remise différée. On ne prend jamais une acheteuse en otage d'un impayé de vendeuse.

Et un test invariant, écrit comme test et non comme intention : **aucune capacité de palier ne peut faire échouer la création d'une commande.** C'est la garantie qui empêche de refaire `delivery.ts:62`.

### 8.5 Ce qui manque dans le schéma, et qu'il faut voir maintenant

`subscriptionStatus` existe (`packages/db/prisma/schema.prisma:74`, `@default(trial)`) et **n'est lu nulle part** — grep exhaustif : la déclaration, le seed (`seed.ts:424`), le client généré, et rien d'autre. Aucune route, aucun job, aucun écran. Le premier `if` qui le lira est une décision d'architecture : il doit vivre dans un module pur `apps/api/src/domain/billing/`, pas dans `bot.ts`.

Surtout : **il n'existe aucune date d'échéance dans le schéma.** Ni `trialEndsAt`, ni `currentPeriodEnd`. L'enum ne porte que `trial / active / past_due / cancelled`. Un essai qui ne finit jamais n'est pas un essai. Il manque une colonne, à ajouter en *expand* avant tout code de facturation.

---

## 9. Le plan, par lots

Un lot par session, chacun avec son ADR. Ordonné par valeur ressentie ÷ effort. **Les lots 1 à 5 ne dépendent en rien du WABA** et peuvent partir dès demain.

---

### Lot A — « Le bot ne se tait plus jamais » *(ADR : les formes entrantes non lues, et l'accusé)*

**Ce que ça change** : un vocal, une position partagée, une vidéo, un sticker, un document reçoivent une réponse au lieu du néant. Chaque message entrant passe en double coche bleue, et l'indicateur de frappe apparaît pendant les traitements lents (téléchargement de média, ré-encodage, carte-vitrine). Une erreur serveur produit un message au lieu d'un silence.

**Contenu** : ajouter un genre `autre` à `lireEntreesBot` (`entrees.ts:69-92`) couvrant `audio`, `video`, `sticker`, `document`, `location`, `contacts` ; une réponse dans les trois fils, avec **les boutons de l'état courant** ; `status: "read"` + `typing_indicator` posés dans `traiterEntree` (`bot.ts:255`) ; un message de repli dans le `catch` de `bot.ts:209-214`.

**Copie FR** : « Je ne sais pas encore écouter les vocaux — écrivez-moi, ou envoyez la photo avec « nom prix » en légende. » **EN** : « I can't listen to voice notes yet — write to me, or send the photo with "name price" as caption. »

**Effort** : petit. **WABA** : aucun. **C'est le lot 1.** Il supprime le seul silence total du produit et il est le plus visible immédiatement.

---

### Lot B — « Les cinq bloquants » *(ADR : les gestes qui traversent, et la ville)*

**Ce que ça change** : plus aucune commande perdue au dernier appui.

1. `tape === "confirmer"` (`conversation.ts:746`) n'ouvre la contre-signature **que hors du tunnel d'achat** — c'est-à-dire jamais quand `etat.nom === "recap"`. Idem pour « avis », « noter », « review » dans `avis_mot`.
2. `extraireSlugBoutique` (`:283-289`) s'ancre en **début** de message, tolère une suite (« salut, boutique chez-amina » doit continuer de marcher), et n'est **pas consulté** dans les états `details` et `avis_mot`. C'est cette dernière condition qui fait le travail ; l'ancrage n'en est que la ceinture.
3. La ville : liste fermée à l'inscription, normalisation accents/casse, et **la création de boutique échoue tout de suite** si la ville ne passe pas `deliverySchema` — pas la commande d'une acheteuse trois semaines plus tard. Migration de rattrapage pour les boutiques existantes.
4. Le numéro : accepter le format que le bot affiche (`6 90 11 22 33`) dans `conversation.ts:1046`.
5. Les mots-clés globaux (`motCleGlobal`) reconnus **aussi** dans le fil vendeuse et le fil inscription.

**Effort** : moyen. **WABA** : aucun.

---

### Lot C — « L'aiguillage arbitre au lieu d'avaler » *(ADR : la priorité des gestes non ambigus)*

Le §2 de ce rapport, intégralement. **Effort** : moyen. **WABA** : aucun.

---

### Lot D — « On choisit, on ne tape plus » *(ADR : listes et sorties)*

**Ce que ça change** : la quantité devient une liste de 1 à 8 + « Un autre nombre » + « Retour ». Le quartier devient une liste alimentée par `QUARTIERS` (26 valeurs déjà écrites, jamais utilisées). Le bouton « Parler à la vendeuse » apparaît dans **tous** les états du tunnel. « Corriger » au récap rouvre la saisie de livraison au lieu de renvoyer au panier. Le panier devient visible depuis l'accueil. L'expiration à 24 h se dit. `CORPS_INTERACTIF_MAX = 1024` est séparé de `CORPS_TEXTE_MAX = 4096`.

**Effort** : moyen. **WABA** : aucun.

---

### Lot E — « Le paiement cesse de mentir » *(ADR : l'opérateur de l'acheteuse)*

**Ce que ça change** : le bloc paiement affiche **les deux** codes d'entrée, étiquetés par le portefeuille de l'acheteuse, lus de `RAMPE_DEFAUT`. La phrase « **En un tap, le clavier pré-rempli** » (`textes.ts:296`) disparaît : ce n'est pas un tap, c'est une sortie de WhatsApp, un chargement de page et un `GET /api/rampe`. Le lien `/payer` porte ses cinq paramètres. Le ✅ posé sur le SMS collé devient 👀.

**Effort** : petit. **WABA** : aucun. **Fort rendement** : c'est un défaut d'argent dans un pays double SIM.

---

### Lot F — « Le reçu devient un objet » *(ADR : le reçu-image)*

**Ce que ça change** : la valeur n°1 du produit cesse d'être une phrase renvoyant à un lien enseveli. Une image générée par la chaîne de `carte-vitrine.ts` (SVG + QR + ré-encodage sous 100 Ko, ADR 0037), QR vers `/v/?c=<code>`, posée en **en-tête d'un message à boutons** portant `[Contresigner]`. Elle circule aussi bien que la fausse capture qu'elle tue, et n'importe qui la vérifie.

**Effort** : moyen. **WABA** : aucun pour l'envoi. **Le reçu-image est une SORTIE** — il ne réintroduit jamais la capture d'écran en entrée de contrôle.

---

### Lot G — « La vendeuse corrige ce qu'elle a publié » *(ADR : l'édition dans le fil)*

Mot-clé « prix » et « supprimer » dans `reagirVendeuse`, liste des articles, `mediaId` conservé dans tous les états d'article, photo accusée explicitement, `lirePrix` aligné sur `lireLegendeArticle` avec confirmation quand deux nombres apparaissent, numéro de téléphone reconnu comme numéro et pas comme prix. **Effort** : moyen. **WABA** : aucun.

---

### Lot H — « L'entonnoir a une porte » *(ADR : l'acquisition depuis une boutique)*

Bouton « Vendre avec Catalog » à l'accueil de boutique, portant le slug visité comme parrain (le champ `EtatVendeuse.parrain` existe déjà, `inscription.ts:39`). Offre de bascule FR/EN visible à l'accueil, et `langueDemandee` élargi. **Effort** : petit.

---

### Lot I — « La facturation existe » *(ADR : les deux paliers)*

Module pur `domain/billing/`, colonne d'échéance en *expand*, `filVendeuse` qui écrit enfin `botConversation` (le défaut de §3.2 — c'est un prérequis de facturation, pas une finition), plafond DIT et affiché. **Effort** : moyen. **WABA** : aucun pour la mécanique, total pour la vente.

---

### Lot J — « Les gabarits » *(ADR : le catalogue de gabarits et l'opt-out)*

Les cinq gabarits du §7, soumis, plus la mécanique d'envoi hors fenêtre et l'opt-out. **Effort** : moyen. **Dépendance WABA : totale, et la date ne nous appartient pas.**

---

### Lot K — « Le Flow » — **à spécifier, pas à planifier**

L'inscription et la livraison en un écran natif. `grep -rn '"flow"|nfm_reply|location_request'` sur tout le dépôt : **zéro occurrence**. La maquette validée classe les Flows 🟣 WABA (`bot-cible.html:232`) et CLAUDE.md reprend le mot. **Et le chemin question-par-question doit rester** — `lireDetailsLivraison` ne se supprime pas : c'est le seul chemin qui marche sur un Android bas de gamme à WhatsApp non à jour, et la maquette le dit explicitement (« Le chemin question-par-question reste »).

---

## 10. Ce que je ne recommande PAS, et pourquoi

**Le formulaire d'adresse natif de Meta (`address_message`).** Deux motifs de refus, chacun suffisant : il n'est proposé qu'aux entreprises d'Inde et de Singapour, et il modélise un pays où l'adresse postale existe. AGENTS.md l'interdit, l'ADR 0005 explique pourquoi. À noter dans un ADR pour que la question ne se repose pas.

**Un bouton « Appeler la vendeuse » natif.** Structurellement impossible : le numéro de la vendeuse n'est jamais sur l'API (ADR 0034), et la Business Calling API ferait sonner le WABA de Catalog. Promettre ce bouton serait promettre ce que l'architecture interdit. La vCard est le substitut, et elle est gratuite.

**Supprimer la grammaire à virgule au profit du seul Flow ou de la seule localisation.** Le GPS est coupé pour économiser la batterie, imprécis en intérieur, et exige une permission. Le repère écrit reste obligatoire : le livreur appelle et se fait guider (ADR 0005).

**Remplacer « Plus que 2 disponibles » par « La vendeuse en annonce 2 » côté bot.** C'est peut-être mieux, mais CLAUDE.md ratifie nommément la copie actuelle. Ça se rouvre par un ADR, pas au détour d'une refonte.

**Écrire « des frais hors réseau s'appliquent » en dur sous une ligne opérateur.** Le hors-réseau dépend du **couple** (portefeuille de l'acheteuse, portefeuille de la vendeuse) — 2,22 % mesuré MTN → Orange. AGENTS.md exige de distinguer les deux cas : ça se calcule, ou ça ne s'écrit pas.

**Facturer la notification « nouvelle commande » à la vendeuse.** C'est une régression sur une fonction livrée et gratuite (`bot.ts:793-808`), et la personne punie serait l'**acheteuse**, qui n'a choisi aucun palier et attend une vendeuse non prévenue. Par l'argument de réseau du §8.3, une commande sans réponse est une entrée de preuve perdue.

**Un quota d'articles ou de commandes sur le palier gratuit.** Le concurrent du gratuit n'est pas un logiciel, c'est WhatsApp nu. Le dépôt possède déjà, par accident, une version de ce blocage — `delivery.ts:62` qui empêche toute boutique hors de deux villes de vendre en livraison. **Construire une version délibérée de ce blocage serait indéfendable.**

**Une transcription automatique des vocaux publiée sans confirmation.** Le §7.7 impose de faire confirmer l'extrait. Le chemin `article_confirme` existe déjà et l'accueille tel quel — mais la transcription vient après le lot A, pas avec.

**Le pidgin fabriqué à la machine.** ADR 0033. Il s'écrira après relecture par une locutrice, jamais autrement.

---

## 11. Les questions qui reviennent au porteur

1. **La ville des boutiques.** `deliverySchema` n'accepte que « Douala » et « Yaounde ». Le Cameroun n'en fait pas deux. Faut-il (a) étendre l'enum à une liste de villes, (b) le remplacer par une chaîne libre validée à l'inscription, ou (c) cesser d'injecter la ville de la boutique dans la livraison de l'acheteuse ? Ce n'est pas un correctif technique : c'est le périmètre géographique du produit. **Et il y a des boutiques déjà créées avec une ville invalide** — la migration de rattrapage dépend de la réponse.

2. **Le prix du troisième palier.** Le « numéro dédié sous le WABA Catalog » (ADR 0035:24-25) suppose une licence de plateforme facturée par numéro. **Ce montant n'existe nulle part dans le dépôt.** Il faut le chiffre réel de 360dialog avant d'écrire une ligne de tarification.

3. **Le plafond de gabarits acheteuse sur le palier gratuit.** J'ai posé le principe (plafond DIT, calibré haut, dépassement = retour en file). Le nombre est une décision commerciale.

4. **La date d'échéance d'abonnement.** Il manque une colonne au schéma (`trialEndsAt` ou `currentPeriodEnd`). Quelle durée d'essai, et que se passe-t-il exactement à son terme ?

5. **La délégation bornée.** L'ADR 0035:21 dit en toutes lettres « L'implémentation attend son propre ADR de modèle ». Ce n'est pas un interrupteur : c'est une seconde identité par boutique sur un WABA où tout est clé par `wa_id` (`cleConversation`, `bot.ts:239`), plus un modèle de permissions, plus la garantie qu'une déléguée ne voie pas les totaux alors que `filVendeuse` renvoie `soldesXaf` (`bot.ts:1379`). Périmètre exact = décision porteur.

6. **`product.variants` reste une colonne morte** (CLAUDE.md, point 1). La question « taille / couleur / modèle » est la troisième FAQ du bot et renvoie aujourd'hui à la vendeuse. Rien ne change tant que le modèle de variante n'est pas arbitré.

7. **Le stock ne se décompte pas** (ADR 0038). Décidé, pas oublié. Je ne le rouvre pas — mais la liste de quantité du lot D affichera « 1 à 8 » plafonnée par le stock annoncé, ce qui rend le chiffre annoncé un peu plus visible. À valider.

8. **Le canari de la fenêtre de service.** `decisionRemise` approxime la fenêtre Meta par `BotConversation.updatedAt`. C'est honnête et documenté (`domain/bot/notifications.ts:6-13`). Le jour du WABA, faut-il la remplacer par la vraie donnée si Meta l'expose, ou garder l'approximation ?

---

*Fin du rapport. Les cinq bloquants du §1 sont indépendants les uns des autres et se corrigent sans WABA. Le lot A — supprimer le silence — est celui que je livrerais en premier si je ne devais en livrer qu'un.*