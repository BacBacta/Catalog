# PROMPTS-premium.md — de la maquette validée à l'implémentation

La cible d'expérience est **validée par le porteur du produit** le 15/08/2026 :
`docs/terrain/parcours-premium.html`. Cette maquette est la **spécification
d'expérience** de la suite — les deux personas s'y jouent de bout en bout, et
chaque pas y est étiqueté :

- **en place** — le dépôt répond déjà ainsi, la source est citée. **Ne pas
  refaire, ne pas réécrire cette copie.** Un lot qui « améliore » un message
  en place au passage est en dérive.
- **cible** — à construire. C'est le contenu des lots P1 à P7 ci-dessous.
- **étage 2 · premium** — attend un ADR du porteur du produit (pricing,
  catalogue natif Meta, numéro dédié). **Aucun lot ne s'en approche.**

L'inventaire détaillé des écarts vit dans `docs/terrain/parcours-vendeur-v2.html`.
La copie des messages de la maquette est la copie à livrer : elle est écrite en
français final, avec ses emoji — on la reprend, on ne la réinvente pas.

**Un lot par session**, dans l'ordre. Chaque prompt est autonome : il se colle
tel quel dans une session neuve, précédé du préambule.

---

## État de la séquence — au 15/08/2026

| Lot | État | Ce qui a été livré |
|---|---|---|
| Audit | ✅ | Les 7 lots du plan `docs/audit-pipeline-2026-08.md` §6 — ADR 0089 à 0094, plus C-01/C-04/C-07 et les résidus §4.3 |
| **P0** | ✅ | ADR 0095 — la maquette actée, l'ordre audit-d'abord, les quatre décisions posées |
| **P1** | ✅ | ADR 0096 — `domain/bot/rafale.ts`, états `rafale` / `rafale_correction`, file pg-boss `bot-rafale-recap` |
| **P2** | ✅ | `carteVitrine(deps, sellerId, "poussee")` — décision P0-c |
| **P3** | ⏳ | **Le prochain.** Voir les acquis de cadrage ci-dessous, ils sont déjà payés |
| P4 → P7 | ⏳ | Inchangés |

Ce que P1 et P2 ont ajouté et qui sert aux lots suivants :

- `EtatVendeuse` accueille des états à charge utile (`rafale` porte un tableau
  de brouillons) et `normaliserEtatVendeuse` les relit défensivement — le
  patron à copier pour tout nouvel état ;
- un **travail pg-boss débordé par conception** (`executerRecapRafale`) :
  chaque événement replanifie, celui qui se réveille vérifie sur l'état RÉEL
  que la fenêtre est échue et qu'on n'a pas déjà parlé. Patron réutilisable
  pour toute temporisation ;
- la matrice du harnais couvre `inscription` en 63/63 : **tout état neuf s'y
  ajoute dans son lot** (`ETATS_MACHINE` + un cas dans `amenerInscription`) ;
- un mode « poussé » vs « demandé » sur un message : le premier échoue en
  SILENCE, le second s'explique. À reprendre pour tout service rendu d'office.

---

## Ce que Meta permet, et ce qu'on s'impose

À connaître avant tout lot qui touche au fil. Tout est déjà acté par ADR :

| Fait | Conséquence | ADR |
|---|---|---|
| 3 boutons max, 10 lignes de liste max | une carte = un choix court ; au-delà, une liste ; au-delà, on découpe le service | 0035, 0088 |
| Les Flows ne se créent PAS par l'API 360dialog | le JSON du Flow est versionné dans le dépôt et déposé À LA MAIN dans le Hub ; les noms de champs sont un CONTRAT tenu par un test | 0055 |
| Fenêtre de service de 24 h | dans la fenêtre : message libre, gratuit, immédiat ; hors fenêtre : la notification ATTEND, sauf gabarit utilitaire | 0054 |
| Les gabarits utilitaires sont facturés par Meta | on ne réveille un fil que pour une utilité (commande, paiement, remise) — jamais pour du confort | 0054, 0060 |
| `cta_url` est accepté | pour « va voir cette page » (reçu, suivi, espace) ; JAMAIS pour un lien à copier (le lien de boutique reste du texte) | 0087, 0088 |
| Un entrant peut arriver deux fois | tout traitement d'entrant est idempotent | 0040 |
| Deux bulles de suite sans geste entre elles = un défaut | on groupe, on ne pousse pas | 0086, 0088 |

---

## Préambule — à coller au début de chaque session

```
Tu implémentes la cible premium de Catalog : le fil WhatsApp qui se comporte
comme une application — un service par carte, un seul geste actif, des Flows
Meta à la place des interrogatoires, et une conversation libre réduite au seul
message inautomatisable : le SMS de preuve collé par la vendeuse.

Avant toute chose, lis dans cet ordre :
1. AGENTS.md à la racine — le contrat de travail, il prime sur tout ;
2. docs/terrain/parcours-premium.html — la SPÉCIFICATION d'expérience validée.
   Lis le HTML source : les scénarios VENDEUSE et ACHETEUSE contiennent la
   copie finale des messages, et la colonne « sous le capot » cite les sources
   de ce qui existe déjà ;
3. les ADR cités par le lot demandé.

Rappels qui reviennent le plus souvent :
- les montants sont des ENTIERS en XAF ; l'acompte est floor(total/2) et le
  solde préserve le total au franc près (splitDeposit, ne pas « corriger ») ;
- il n'existe pas d'adresse au Cameroun : quartier + repère + téléphone ;
- Catalog n'encaisse jamais, ne prélève rien : dépôt direct (ADR 0009) ;
- seul le SMS reçu par la vendeuse prouve un paiement ; le collage n'est
  JAMAIS bloqué ; le SMS brut ne va dans aucune trace (ADR 0023) ;
- toute copie de message vit dans le domaine (textes.ts, notifications.ts…)
  et existe en FRANÇAIS ET EN ANGLAIS ; le pidgin (wes) s'écrit mais ne se
  sert pas tant que PIDGIN_RELU est false (ADR 0034) — ne pas y toucher ;
- src/domain est PUR : pas de Prisma, pas de fetch, pas de Date.now(), pas de
  Math.random(), pas de process.env — le temps et l'aléa arrivent en
  paramètre. pnpm test:coverage exige 90 % sur src/domain ;
- le fil ne pousse jamais deux messages sans geste entre eux : on groupe ;
- TZ=Africa/Douala partout, serveur et tests.

Travaille uniquement sur le lot demandé. N'anticipe pas les lots suivants.
Ce que la maquette marque « en place » ne se refait pas ; ce qu'elle marque
« étage 2 · premium » ne se commence pas. Face à une ambiguïté, arrête-toi et
pose la question. Tout écart à la maquette ou aux ADR produit un ADR.

Définition de terminé commune à tous les lots :
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm size
— les cinq passent, plus les vérifications propres au lot.
```

---

# LOT P0 — L'ADR de cadrage : décisions posées, audit intégré

À exécuter en premier. **Ce lot n'écrit aucun code produit.** Il n'attend
aucun arbitrage : les quatre décisions ci-dessous sont **posées par défaut**
au nom du porteur du produit — chacune reste réversible par un ADR de
révision d'une page, et l'ADR le dit.

```
La maquette docs/terrain/parcours-premium.html est validée comme cible
d'expérience (15/08/2026). Un audit de pipeline de bout en bout est mené en
parallèle selon docs/audit — son rapport est docs/audit-pipeline-2026-08.md
et son harnais tourne dans pnpm test. Écris l'ADR qui articule les deux,
dans docs/adr/ au prochain numéro libre (après ceux que l'audit a produits) :

« La cible premium : le fil comme application »

L'ADR doit :

1. ACTER la maquette comme spécification d'expérience, et la doctrine qu'elle
   joue : un service = une carte structurée ; un seul geste actif à la fois ;
   les Flows Meta remplacent tout dialogue de plus de deux champs ; la
   conversation libre est l'exception mesurable (1 message tapé côté
   vendeuse — le SMS —, 0 côté acheteuse).

2. ORDONNER le travail contre l'audit : les constats CONFIRMÉS de
   docs/audit-pipeline-2026-08.md de sévérité « dangereux », « muet » ou
   « faux » se corrigent AVANT tout lot de nouveauté — un parcours premium
   posé sur un pipeline qui ment n'est pas premium. Puis P1 à P7 dans
   l'ordre de PROMPTS-premium.md. Le « en place » de la maquette ne se
   refait pas. Chaque lot P doit laisser le harnais de l'audit vert et
   étendre sa couverture aux cartes qu'il ajoute — un service neuf entre
   dans la matrice étape × geste dès son lot.

3. POSER les quatre décisions — par défaut, réversibles par ADR de révision :

   a) La checklist d'onboarding persistante (« 3 étapes pour vendre ») :
      une LIGNE DE PLUS dans la liste native du message d'ouverture
      (ADR 0088), mise à jour à chaque réaffichage — jamais un message de
      plus. L'ouverture vient d'être ramenée à une bulle ; la checklist ne
      la défait pas.

   b) La carte-vitrine carrée (1080×1080) : REPORTÉE. Le Statut (1080×1920,
      ADR 0037) est le canal n° 1 ; le carré attend un besoin constaté.

   c) La poussée de la carte-vitrine : au plus UNE par salve de publication,
      dans la fenêtre ouverte seulement — la carte ne réveille jamais un fil
      fermé, aucun gabarit pour du confort.

   d) Le verbe « préparée » dans le fil : le bouton contextuel appelle la
      MÊME transition que l'app (domain/order/cycle.ts), mêmes refus —
      solde_ouvert compris. Aucun nouveau mot-clé tapé n'est requis ni
      annoncé ; « livrée CT-… » reste.

4. REDIRE ce que la cible ne rouvre PAS : product.variants mort, pidgin non
   servi (PIDGIN_RELU reste false), stock non décompté, étages 2 et 3
   (catalogue natif Meta, MPM, numéro dédié — ADR pricing du porteur),
   lecture automatique des SMS, apps/site intouché.

Définition de terminé : l'ADR est écrit, relu contre AGENTS.md §7.6/§7.7,
les quatre décisions y sont posées noir sur blanc avec leur clause de
réversibilité, et l'ordre audit-d'abord y est explicite. Rien d'autre ne
change.
```

---

# LOT P1 — La rafale : n photos légendées, une confirmation

```
Contexte. Le geste réel d'une vendeuse est la salve de photos, comme pour un
Statut. Aujourd'hui chaque photo légendée « nom prix » produit sa propre
confirmation : cinq photos, cinq cartes — le mur que l'ADR 0086 interdit.
Lis : docs/terrain/parcours-premium.html (pas « La rafale »), ADR 0035, 0040,
0086 ; apps/api/src/domain/bot/inscription.ts (lireLegendeArticle),
conversation.ts, apps/api/src/bot.ts (le traitement des médias).

À faire :

1. Dans src/domain/bot, un COLLECTEUR de rafale, pur : les photos légendées
   d'une même vendeuse s'accumulent en brouillons tant que la fenêtre de
   regroupement est ouverte. La durée de fenêtre et l'horloge ARRIVENT EN
   PARAMÈTRE (pas de Date.now dans le domaine). À la fermeture de la fenêtre,
   UNE carte récapitulative : « n articles prêts à publier », lignes
   numérotées nom + prix, et deux boutons — « Tout publier » et « Corriger
   le N » (reprendre la copie de la maquette).

2. La correction est ADRESSABLE PAR NUMÉRO : « corriger le 2 » (bouton ou
   texte) rouvre le seul brouillon 2 — nom, prix, photo — sans toucher aux
   autres et sans rejouer le formulaire entier.

3. Bornes : 10 brouillons au plus (la limite des listes) ; au-delà, la carte
   invite à publier d'abord. Une photo sans légende lisible entre en
   brouillon « sans nom » et la carte le dit — on n'invente pas un nom.

4. « Tout publier » publie la salve d'un coup, puis UNE carte de retour :
   « Publiés. Votre boutique passe à N articles » (copie de la maquette).
   La reconstruction de la boutique statique passe par la porte existante
   (ADR 0065/0068) — elle absorbe déjà le groupement.

5. Idempotence (ADR 0040) : la même photo relivrée par le webhook ne crée
   pas deux brouillons.

Contraintes : lireLegendeArticle se réutilise tel quel — le prix est le
dernier groupe de chiffres, on ne réécrit pas ce motif. Rien ne se publie
sans confirmation (§7.7). Copie en FR et EN dans le module de textes.
L'app vendeuse ne change pas dans ce lot.

Test d'abord, dans src/domain : la fenêtre qui groupe, la borne à 10, la
correction par numéro, l'idempotence, la photo sans légende, la salve d'une
seule photo (qui doit garder le comportement actuel : une confirmation
simple, pas une carte de rafale pour rien).

Définition de terminé : la chaîne commune passe, plus pnpm test:coverage
(90 % sur src/domain). Démonstration : la séquence de messages produite pour
une salve de 3 photos, écrite dans le test, lisible.
```

---

# LOT P2 — La carte-vitrine entretenue

```
Contexte. La carte-vitrine existe (ADR 0037, disposition ADR 0059) et se
demande (« ma carte »). La cible : elle arrive d'elle-même après chaque
publication — le service rendu avant d'être demandé. Lis : la maquette (pas
« La carte-vitrine, générée ET entretenue »), ADR 0037, 0059, 0086 ; les
décisions c) du lot P0 ; apps/api/src/domain/bot/carte-vitrine.ts,
pack-statut.ts.

À faire :

1. Après une publication d'article — unitaire ou salve du lot P1 —, la carte
   est régénérée et poussée dans le fil, AVEC la carte de confirmation de
   publication (groupées : une salve = une confirmation + une carte, pas
   trois messages). Copie de la maquette : « Votre affiche est prête — je la
   referai à chaque changement, sans que vous la demandiez. »

2. Anti-bruit, selon la décision P0-c : au plus UNE poussée par salve, et
   UNIQUEMENT dans la fenêtre ouverte. La carte ne déclenche jamais un
   gabarit : une vendeuse qui vient de publier a la fenêtre ouverte par
   construction ; si un cas limite la trouve fermée, la carte attend le
   prochain entrant.

3. Le mot-clé « ma carte » reste, inchangé, et reste annoncé.

Contraintes : carte-vitrine.ts reste une fonction pure SVG — les photos sont
composées par l'adaptateur, pas encodées dans la chaîne. Ne pas toucher au
format 1080×1920 (décision P0-b : le carré est reporté).

Test d'abord : publication unitaire → une confirmation + une carte ;
salve → une confirmation groupée + UNE carte ; fenêtre fermée → aucune
tentative de gabarit ; « ma carte » → comportement inchangé.

Définition de terminé : chaîne commune + coverage domaine. Démonstration : le
test qui compte les messages sortants d'une salve (2, pas 4).
```

---

# LOT P3 — Le reversement dans le fil, en Flow

> **Acquis de cadrage, déjà payés — ne pas les re-découvrir.** Une première
> exploration a été menée puis retirée du tronc (elle n'avait ni ADR ni tests,
> et un lot ne se fusionne pas à moitié). Ce qu'elle a établi :
>
> 1. **Le Flow tient en UN écran, pas deux.** Un Flow statique n'a aucun
>    aller-retour serveur : au moment où l'écran s'affiche, le code OTP
>    n'existe pas encore — il ne peut donc pas y avoir d'écran « saisissez le
>    code ». L'écran recueille numéro + opérateur ; le code part par SMS et se
>    **colle dans le fil**, où le collage n'est jamais bloqué (critère 3.3.8).
>    C'est un écart au texte ci-dessous, et il doit produire son ADR.
> 2. **`changerNumeroDeReversement` de `routes/payout.ts` est déjà un service
>    exporté**, utilisable hors HTTP : gel, journal d'audit dans la même
>    transaction, alerte SMS à l'ancien numéro. Le fil doit l'appeler tel quel
>    — pas de second chemin. Les deux tables de messages de refus y sont
>    privées (`MESSAGE`, `MESSAGE_OTP`) : les exporter est le seul changement
>    à faire dans ce fichier.
> 3. **Les gardes de la route se rejouent dans le fil, dans le même ordre** :
>    gel (`reversementGeleDepuis`), numéro inchangé, limitation de débit
>    (`checkOtpRateLimit` avec une « adresse » stable du genre `fil:<phone>`),
>    puis `otp.emettre` → SMS vers le NOUVEAU numéro → état d'attente du code.
>    Un envoi SMS qui échoue ne doit poser AUCUN état : sinon le fil attend un
>    code qui n'est jamais parti.
> 4. **Un code incorrect se recolle** sans rejouer le Flow (l'état reste) ;
>    expiré / épuisé / déjà servi exigent un nouveau code (l'état se ferme).
> 5. `GenreFlux` et `jetonFlux` acceptent un genre de plus sans rien casser —
>    c'est le point d'entrée (`genreDuJeton(reponse) === "reversement"`), à
>    traiter dans `filInscription` **avant** la question directe, comme le
>    formulaire d'article.

```
Contexte. Le numéro de reversement — là où l'argent arrive — se règle
aujourd'hui dans l'espace web, avec OTP (lot 4). La cible le ramène dans le
fil : un Flow Meta (numéro + opérateur), puis le code reçu par SMS et collé
dans la conversation, au moment où il coûte le moins. Lis : la maquette (pas
« Être payée d'avance »), ADR 0025 (IMPORTANT), 0055, 0087 ; les acquis de
cadrage ci-dessus ; apps/api/src/routes/payout.ts, apps/api/src/domain/bot/
flux.ts (le modèle : contrat de champs + lecteur).

À faire :

1. Le JSON du Flow « reversement », versionné dans le dépôt à côté des Flows
   existants, sur le modèle de l'ADR 0055 : UN écran — numéro et opérateur,
   champs obligatoires —, noms de champs = CONTRAT tenu par un test miroir de
   celui du Flow de livraison. Le second écran n'existe pas, et l'ADR du lot
   doit dire pourquoi (acquis n° 1). Le dépôt dans le Hub 360dialog reste un
   geste MANUEL : documente-le dans le même runbook que le Flow d'ouverture,
   ne prétends pas l'automatiser.

2. Dans le domaine : le lecteur de la réponse (modèle lireReponseFlux), et
   l'accroche dans la conversation vendeuse — le bouton « 💳 Être payée
   d'avance » sur la carte d'invitation (copie de la maquette), qui
   n'apparaît que si le numéro n'est pas encore vérifié.

3. La vérification réutilise LE MÊME service OTP que l'espace web
   (payout.ts) : mêmes limites de débit, même journalisation d'audit, même
   exigence de re-vérification à tout changement. Pas de second chemin.

4. Repli sans Flow : le comportement actuel (lien vers l'espace web) reste
   le repli complet — un transport qui ne sait pas monter un Flow garde un
   parcours entier.

5. La relance existante (~20 h, ADR 0035) et le rappel à la première
   commande partie sans acompte (notifications.ts) restent : ils pointent
   désormais vers le Flow quand le canal le permet, vers l'espace sinon.

Contraintes — deux gardes à ne PAS « corriger » en passant :
- ADR 0025 : quand SMS_PROVIDER=whatsapp, le code du reversement arrive sur
  la même puce que la connexion — c'est un report EXPLICITE du porteur, pas
  un défaut. Ne change pas l'aiguillage des canaux.
- Le champ du code accepte le COLLAGE et l'auto-remplissage, dans le Flow
  comme partout (critère 3.3.8) — vérifie que le type de champ du Flow JSON
  ne l'interdit pas.

Test d'abord : le contrat de champs du Flow ; le lecteur (réponse complète,
réponse malformée) ; l'invitation qui disparaît une fois vérifié ; le refus
de changer le numéro sans nouvel OTP ; l'audit journalisé.

Définition de terminé : chaîne commune + coverage domaine + le runbook de
dépôt du Flow mis à jour. Démonstration : le test du contrat de champs.
```

---

# LOT P4 — Les étapes en boutons, et l'absence restituée en une carte

```
Contexte. Le fil ne connaît que « livrée CT-… » tapé ; les étapes
intermédiaires vivent dans l'app. Et une vendeuse qui se réveille avec trois
commandes reçoit trois notifications — le mur. Lis : la maquette (pas
« Nouvelle commande », « Marquer préparée », « Remise faite »), décision
P0-d, ADR 0086 ; apps/api/src/domain/order/cycle.ts,
apps/api/src/domain/bot/notifications.ts.

À faire :

1. La notification de commande (corpsNouvelleCommande) devient une carte à
   boutons : « 🧺 Marquer préparée » + « 💬 Écrire à la cliente » (lien
   wa.me). Le bouton appelle LA MÊME transition que l'app — avancer() de
   cycle.ts — avec les mêmes refus, dits en langue simple (corpsLivraisonRefusee
   existe déjà pour ça).

2. Au fil de l'avancement, le bouton suivant suit l'étape : préparée →
   « 🛵 Chez le livreur » (si mode livraison) → « 📦 Remise faite ».
   GARDE : la transition vers « livrée » est REFUSÉE tant que le solde est
   ouvert (refus solde_ouvert, cycle.ts:117). Dans ce cas le bouton ne se
   montre pas ; la carte rappelle le solde attendu et le collage du SMS —
   c'est le produit : pas de remise close sans preuve ou déclaration.

3. Le mot-clé « livrée CT-… » tapé reste et reste annoncé : il marche depuis
   n'importe où, le bouton n'est qu'un raccourci contextuel.

4. La restitution d'absence : quand plusieurs notifications attendent la
   réouverture de la fenêtre, elles se COMPILENT en une carte « Pendant
   votre absence » — n commandes, références + montants, « commandes » pour
   le détail (copie de la maquette). Une notification seule reste une carte
   complète, comme aujourd'hui.

Contraintes : un paiement ne recule jamais ; une transition arrière est
journalisée puis ignorée. Trois boutons max par carte. L'app vendeuse ne
change pas — les deux comptoirs partagent déjà le moteur (ADR 0061).

Test d'abord : chaque bouton → la bonne transition ; le refus solde_ouvert
masque « Remise faite » et affiche le rappel ; retrait vs livraison → la
bonne séquence d'étapes ; 3 notifications en attente → UNE carte ; 1 en
attente → la carte complète habituelle ; idempotence du bouton pressé deux
fois (ADR 0040).

Définition de terminé : chaîne commune + coverage domaine. Démonstration :
le test de la séquence complète recue → preparee → chez_le_livreur → livree
pilotée aux boutons, avec le solde réglé entre les deux dernières.
```

---

# LOT P5 — Le suivi acheteuse, poussé pas à pas

```
Contexte. L'acheteuse vit le moment le plus anxieux du commerce à distance —
« mon argent est parti » — et le produit ne lui parle qu'à la remise. La
cible : chaque étape franchie par la vendeuse met à jour une timeline dans le
fil de l'acheteuse. Lis : la maquette (pas « timeline » du parcours Marie),
ADR 0054, 0060, 0086 ; le lot P4 (les transitions émettent désormais des
événements propres).

À faire :

1. Dans le domaine : le composeur de la carte de suivi — les jalons de la
   commande (acompte prouvé ✓, en préparation, remise & solde, avis), l'état
   courant marqué, copie de la maquette (« Voici votre suivi — il se mettra
   à jour tout seul »). Une transition = UNE mise à jour de carte, jamais
   deux messages.

2. Politique de fenêtre, à écrire dans le lot et à faire acter par l'ADR P0
   si elle n'y est pas déjà :
   - fenêtre acheteuse OUVERTE → la mise à jour part immédiatement ;
   - fenêtre FERMÉE → seuls les jalons UTILES réveillent le fil par gabarit
     utilitaire (ADR 0054) : le verdict de paiement (déjà fait, ADR 0083) et
     la remise imminente/faite. Les jalons intermédiaires attendent le
     prochain entrant — informer n'est pas réveiller.

3. La page de suivi web existante reste la référence longue ; la carte du
   fil pointe vers elle en cta_url (c'est un « va voir cette page », l'usage
   légitime de cta_url).

Contraintes : ne jamais faire ouvrir le suivi par la référence ou le code de
vérification — le jeton acheteuse seul autorise (ADR 0021). La carte de
suivi ne contient ni le SMS ni aucun détail de preuve : le verdict, pas la
matière. Copie FR/EN.

Test d'abord : chaque transition → la carte attendue ; fenêtre fermée +
jalon intermédiaire → rien ne part, l'état est mémorisé ; fenêtre fermée +
remise → gabarit ; deux transitions rapprochées → les cartes restent une par
transition, dans l'ordre (envoyer un par un — envoyeur.ts).

Définition de terminé : chaîne commune + coverage domaine. Démonstration :
le test du parcours complet vu du fil acheteuse, de l'acompte au ✓ final.
```

---

# LOT P6 — Le résumé du matin

```
Contexte. Le service automatisé par excellence : zéro demande, la journée
démarre par les faits et l'action suivante. Lis : la maquette (pas « Votre
matin »), ADR 0022 (l'honnêteté des chiffres), 0023 (rédaction des traces),
0054 ; apps/api/src/domain/stats/periode.ts, src/jobs (pg-boss).

À faire :

1. Dans le domaine, PUR : le composeur du résumé — entrées : la date du
   jour (en paramètre), les faits d'hier (commandes, paiements prouvés,
   visites SI vuesInstrumentees, avis reçus) et les restes à faire
   (commandes à préparer, SMS attendus). Sortie : la carte de la maquette,
   ou RIEN. Le silence est une sortie de plein droit : une boutique sans
   fait n'envoie pas de résumé — pas de « rien à signaler ».

2. Le job pg-boss quotidien, 07:30 Africa/Douala. Le fuseau n'a pas d'heure
   d'été : l'heure cron est fixe, mais écris-la en un endroit commenté.

3. Politique d'envoi : fenêtre ouverte → message ; fermée → gabarit
   utilitaire SI l'ADR P0 l'a accordé au résumé, sinon la carte attend le
   prochain entrant. Dans tous les cas, opt-out en un mot : « stop résumé »
   (et son annonce dans la première carte envoyée), réversible.

4. Les visites ne se mentionnent QUE si elles sont réellement comptées
   (drapeau vuesInstrumentees, ADR 0022) — le résumé ne peut pas être le
   premier endroit où le produit invente un chiffre.

Contraintes : aucune donnée de SMS dans le résumé ; les montants en
formatXaf ; copie FR/EN ; idempotence — le job relancé le même jour
n'envoie pas deux fois (clé de déduplication par vendeuse et par date).

Test d'abord : composeur avec faits → la carte ; sans faits → null ;
visites non instrumentées → la ligne n'existe pas ; opt-out → plus rien ;
relance du job → un seul envoi.

Définition de terminé : chaîne commune + coverage domaine. Démonstration :
le test « sans faits → silence », cité dans le message de commit.
```

---

# LOT P7 — L'avis en Flow

```
Contexte. L'avis vérifié existe (ADR 0076) : demandé à la remise, il passe
aujourd'hui par un lien web. La cible : un Flow d'un écran — la note, un mot
facultatif — sans quitter WhatsApp. Lis : la maquette (pas « Laisser un
avis »), ADR 0036, 0055, 0076 ; le module d'avis existant.

À faire :

1. Le JSON du Flow « avis », versionné et déposé à la main (même runbook que
   P3) : un écran, note obligatoire, commentaire facultatif borné. Contrat
   de champs tenu par un test.

2. Le lecteur de réponse dans le domaine, et le branchement : à la remise,
   la carte d'invitation porte le bouton Flow quand le canal le permet, le
   lien web sinon — le lien reste le repli complet.

3. GARDE INCHANGÉE : l'avis n'est recevable que sur un achat vérifié
   (estAchatVerifie, cycle.ts) — le Flow ne crée pas un chemin qui
   contourne la vérification. Un avis re-soumis remplace le précédent de la
   même acheteuse sur la même commande, il ne s'additionne pas (idempotence).

4. La distribution existante (boutique, fiche article si productId) ne
   change pas.

Test d'abord : contrat de champs ; réponse valide → avis enregistré ;
commande non vérifiée → refus ; double soumission → un seul avis ; repli
lien quand le Flow n'est pas disponible.

Définition de terminé : chaîne commune + coverage domaine. Démonstration :
le test du refus sur commande non vérifiée.
```

---

## Hors séquence — les étages 2 et 3

Le catalogue natif Meta (la grille de produits dans WhatsApp, les messages
multi-produits), et le numéro dédié par vendeuse sous le WABA Catalog, sont
**des décisions de gamme, pas des lots** : coût réel par numéro chez le BSP,
palier d'abonnement, engagement de support. La maquette les montre pour que la
cible soit regardable en entier ; **ils ne se commencent pas sans un ADR du
porteur du produit qui en fixe le pricing.** L'étage 1 — tout ce que les lots
P1 à P7 construisent — est la fondation, et il doit être en production d'abord.

---

## Comment piloter la séquence

1. Une session = le préambule + UN lot, collés tels quels. Ne jamais donner
   deux lots à la même session.
2. P0 d'abord — il fixe quatre décisions dont P2, P4, P5 et P6 dépendent.
   Ensuite P1 → P7 dans l'ordre : chaque lot s'appuie sur les événements et
   les cartes du précédent.
3. Après chaque lot : la chaîne de vérification commune, la revue du diff
   contre la maquette (la copie livrée est-elle celle de la spec ?), et le
   banc d'essai terrain (docs/terrain/banc-essai-parcours-vendeur.html) pour
   les lots qui changent le fil.
4. Tout écart constaté en cours de lot — un format non confirmé, une règle
   floue, une limite d'API différente de la doctrine — s'arrête et remonte :
   AGENTS.md §7.7. Un écart accepté produit un ADR.
5. Les maquettes se REJOUENT après chaque lot livré : quand une copie change
   dans les sources, elle change dans docs/terrain/parcours-premium.html au
   même commit — c'est ce qui garde la spec vivante, et l'étiquette « cible »
   d'un pas livré passe à « en place » avec sa source.
