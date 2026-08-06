# Analyse transversale — de la création de boutique jusqu'à l'avis vérifié

Date : 02/08/2026 · Périmètre : LA TRAVERSÉE COMPLÈTE — inscription vendeuse,
catalogue, panier, commande, paiement, preuve, reçu, cycle de vie, avis,
réputation — sur les trois surfaces (fil WhatsApp, app vendeuse, boutique
publique) · Méthode : suivre une vendeuse et une acheteuse réelles de bout en
bout dans le code, vérifier chaque couture, comparer au meilleur de 2026.

Les analyses précédentes (`2026-08-02-analyse-critique-bot.md`) ont optimisé
des SEGMENTS. Celle-ci juge les COUTURES — et c'est aux coutures que le
produit casse.

---

## 1. Le verdict en une phrase

**Chaque station du pipeline fonctionne ; la traversée est morte.** Une
boutique née dans le fil ne peut structurellement JAMAIS produire un avis
vérifié — le sommet du produit — parce que quatre coutures cassées se
verrouillent en cascade, et le paiement lui-même débouche sur une impasse :
le bot dit « pour payer, ouvrez ce lien », et la page ouverte ne sait pas
payer.

---

## 2. La carte, et où ça casse

```
INSCRIPTION ──①── CATALOGUE ──②── PANIER/COMMANDE ──③── PAIEMENT ──④── PREUVE ──⑤── AVIS
 (fil, ADR 0047)   (bot + web      (bot, ADR 0033)      (rampe USSD,     (7 contrôles,   (suivi,
                    + boutique)                          lot 9)           lot 8/10)       lot 12)
```

- **① Inscription → boutique opérante** : la vendeuse sort du fil sans accès
  à rien d'autre. CASSÉE.
- **② Catalogue** : deux vitrines, une vivante (bot), une morte (boutique
  statique). DIVERGENTE.
- **③ Panier → commande** : solide depuis l'ADR 0033, deux fuites restantes.
- **④ Commande → paiement** : LE trou. Le lien de paiement mène à une page
  sans paiement. CASSÉE.
- **⑤ Paiement → preuve → avis** : chaque maillon dépend d'une initiative
  spontanée que personne ne sollicite. INERTE.

---

## 3. La cascade — pourquoi le tout vaut moins que la somme des parties

Suivons **Bea**, inscrite ce matin dans le fil (le parcours ADR 0047
fonctionne, vérifié en préproduction), jusqu'à son premier avis vérifié :

1. Sa boutique n'a **pas de numéro de reversement** — le fil ne le pose
   jamais, à raison (OTP propre, AGENTS.md §2). Elle vend donc en
   `sans_prepaiement` : pas d'acompte, pas de paiement d'avance.
2. Pour le poser, il lui faut **l'espace vendeuse** — dont le message de
   bienvenue ne donne **jamais l'URL** (« votre espace vendeuse », sans
   lien). Elle ne sait même pas qu'un site existe.
3. Sa cliente paie **à la livraison**. En espèces → déclaration manuelle →
   **non tracé** : pas de reçu, pas d'avis vérifié (règle assumée du
   produit). En Mobile Money → il y a un SMS… mais rien ne dit à Bea de le
   coller, et le verdict exige de toute façon l'app (double collage, dette
   ADR 0031).
4. Même si la preuve passait : l'avis vérifié exige la commande **livrée**
   (`droitAuDepot`), et l'avancement d'étape ne vit QUE dans l'app — qu'elle
   ne connaît pas (point 2).
5. Même livrée : le dépôt d'avis vit dans la page de suivi de l'acheteuse,
   que **rien ni personne ne l'invite jamais à rouvrir**.

Cinq verrous en série. Résultat : `nbVerifies = 0` pour toujours → la ligne
de réputation de l'accueil (sprint A) ne s'affiche jamais → l'argument de
confiance — LA raison d'être du produit — n'apparaît sur aucune boutique née
du canal qu'on vient de construire pour acquérir des vendeuses. **Le volant
d'inertie est monté pièce par pièce, et aucun moteur ne le lance.**

---

## 4. Les trous, un par un, vérifiés dans le code

### Couture ④ — commande → paiement : l'impasse (LE plus grave)

| # | Constat | Preuve |
|---|---|---|
| T9 | **La page de suivi ne sait pas payer.** La confirmation du bot dit « Pour payer l'acompte, ouvrez : \<lien de suivi\> ». L'îlot `Suivi.tsx` affiche « Reste à payer : X » en texte passif — **aucun lien vers `/payer`, aucune rampe, aucun numéro**. La page `/payer` existe, complète (USSD `tel:`, îlot de 212 lignes, lot 9), mais attend `?numero=&montant=` que seul le flux web des fiches produit compose. Le flux bot convertit jusqu'au « payer », puis ouvre une porte sur un mur. | `islands/Suivi.tsx:180` (seule occurrence de « payer ») ; `islands/Payer.tsx:53-55` |
| T10 | **Après le paiement, personne n'est prévenu.** L'acheteuse n'est pas invitée à prévenir la vendeuse (`messageVersement` de `contracts` existe pour le web — le bot ne l'utilise jamais) ; la vendeuse ne reçoit rien (structurel pré-WABA) et rien ne lui dit d'aller coller son SMS. La chaîne paiement → preuve repose sur trois initiatives spontanées non sollicitées. | `contracts/whatsapp.ts` (`messageVersement` orphelin du bot) |
| T11 | Le **double collage** du SMS (fil → app) reste ouvert — dette connue de l'ADR 0031, toujours le point de friction du geste central du produit. | `bot.ts`, en-tête |

### Couture ① — inscription → boutique opérante : l'activation

| # | Constat | Preuve |
|---|---|---|
| T1 | **L'URL de l'espace vendeuse n'est jamais donnée.** Le message de bienvenue dit « ajoutez votre numéro Mobile Money dans votre espace vendeuse » — sans lien. `baseApp` existe dans les deps et n'est pas utilisé par l'inscription. Tout ce qui vit dans l'app (reversement, étapes, photos suivantes, statistiques) est inaccessible à une vendeuse née du fil. | `inscription.ts:152` |
| T2 | **Le moteur de confiance est éteint par défaut, et rien ne le rallume.** Reversement absent → `sans_prepaiement` → aucun paiement d'avance prouvable. Une seule mention à la création, aucune relance, aucune checklist de complétion — alors que pg-boss est là et que la relance d'acompte (ADR 0033) montre le patron exact à répliquer. | `bot.ts` (`reversementPose` → mode) |
| T4 | **Une vendeuse née de Google est invisible pour le bot.** Le routage cherche `authUser.phoneNumber` ; un compte né de la cérémonie Google n'en a pas (ADR 0029 : le numéro de contact est un attribut sur `seller.phone`). Elle écrit au bot depuis son numéro déclaré → traitée en acheteuse → son SMS collé reçoit une réponse d'acheteuse. | `bot.ts` (`traiterEntree`) |
| T5 | **Le stock est affiché partout et saisissable nulle part.** Le bot le montre et borne les quantités (sprint B), la boutique publique l'affiche — et AUCUNE interface ne l'écrit : ni le fil, ni `ArticleForm` (« le stock n'est pas demandé ici »). L'API `PATCH` l'accepte ; personne ne l'appelle. C'est exactement le mensonge d'instrumentation que `stats-instrumentation.test.ts` interdit ailleurs : une donnée montrée que personne ne peut produire. | `ArticleForm.tsx:29` |
| T3 | **Aucune métrique d'activation.** Le compteur de transitions du bot (sprint A) mesure l'entonnoir d'ACHAT ; rien ne mesure boutique créée → 1er article → reversement posé → 1re commande → 1re preuve → 1er avis. `canalOuverture` (ADR 0047) est la première brique, seule. | `mesures.ts` |
| — | Le fil est **en ajout seul** : ni modification de prix, ni archivage, ni description depuis WhatsApp. Cohérent avec « le reste vit dans l'app » — mais voir T1. | `inscription.ts` |

### Couture ② — le catalogue : deux vitrines, une morte

| # | Constat | Preuve |
|---|---|---|
| T6 | **La boutique publique est un instantané manuel qui diverge.** Le bot lit la base en direct ; les pages `[slug]` d'Astro sont construites depuis `catalogue.json`, produit par `pnpm shop:snapshot` **à la main**, sans aucun déclencheur. Chez-bea, née ce matin dans le fil, n'existera jamais sur la boutique web tant que personne ne redéploie ; un prix changé diverge entre les deux surfaces jusqu'au prochain déploiement. Les pages de SUIVI et de REÇU, elles, vont bien (îlots branchés sur l'API) — seul le catalogue est mort. | `[slug]/index.astro:16` (`getStaticPaths`), `.gitignore` (`apps/shop/src/data/`) |

### Couture ③ — panier → commande : deux fuites

| # | Constat | Preuve |
|---|---|---|
| T7 | **« menu » vide le panier en silence.** `accueilBoutique` repose `{ page: 0 }` sans panier. « annuler » le dit ; « menu » et le lien d'une autre boutique le font sans prévenir. | `conversation.ts:643` |
| T8 | **Le panier n'est pas consultable** : pas de « voir panier », le corps de l'étape ajout ne montre que le total, jamais les lignes. La première fois qu'on voit ses lignes, c'est au récap. | `textes.ts` (`panierCorps`) |

### Couture ⑤ — preuve → reçu → avis : le volant sans moteur

| # | Constat | Preuve |
|---|---|---|
| T12 | **Le dépôt d'avis existe et n'est jamais sollicité.** `DepotAvis` (5 boutons, commentaire facultatif — bien conçu) vit dans la page de suivi, atteignable uniquement si l'acheteuse rouvre spontanément son lien après la livraison. Aucun message ne le lui demande, jamais. Le standard 2026 : demande systématique à J+7, et les avis remontent la conversion produit de 8 à 15 %. | `Suivi.tsx:256-279` |
| T13 | **Le reçu émis n'est pas annoncé** à l'acheteuse (la contre-signature — contrôle 7 — attend qu'elle repasse par hasard), et **l'expiration à 48 h est silencieuse** pour tout le monde. | lot 10/11, aucun émetteur |
| T14 | **Les étapes du cycle de vie ne s'avancent que dans l'app.** « Livrée » — la condition du droit à l'avis — est hors de portée d'une vendeuse née du fil (voir T1). Un mot dans le fil (« livrée CT-104312 ») suffirait : la machine `avancerEtape` est pure et prête. | `cycle.ts`, `routes/commandes.ts` |

---

## 5. Le benchmark 2026, couture par couture

**Activation vendeuse.** Les places de marché qui structurent l'onboarding
(checklist : boutique → fiche complète → paiement configuré → première vente)
convertissent **~80 % des inscrits en vendeurs actifs sous 30 jours, contre
~30 % sans** ; une fiche complète au lancement convertit 2 à 3× mieux ; le
« time-to-first-sale » est LA métrique de tête. Nous : inscription brillante
(2 minutes, dans le fil — peu font mieux), puis plus rien — ni checklist, ni
relance, ni métrique.

**Chaîne de paiement.** Le standard du commerce conversationnel est la chaîne
ininterrompue : panier → récapitulatif → paiement SANS quitter le contexte
(Flows + paiement in-chat où disponible ; au Kenya/Nigeria, Chpter et Vendy
poussent le STK/USSD directement dans le fil). Notre équivalent local assumé —
la rampe USSD pré-remplie — est BON et existe depuis le lot 9 ; mais le flux
bot n'y mène pas (T9). Le meilleur segment du produit est débranché de son
meilleur canal.

**Post-achat.** Confirmation → suivi actif (notifications d'étapes) → demande
d'avis à J+7 : c'est le socle, pas le luxe — les flux post-achat convertissent
1-2 % à eux seuls et nourrissent la boucle de réputation. Nous : un seul
message post-achat existe (la relance d'acompte, sprint B) ; zéro sur les
étapes, zéro sur le reçu, zéro sur l'avis.

**Cohérence multi-surface.** Le headless 2026 tient une seule source de
vérité produit, synchronisée en temps quasi réel sur toutes les vitrines.
Nous : la vitrine bot est vivante, la vitrine web est un instantané à la main
(T6) — défendable au lot 6 quand la boutique était LE canal, plus depuis que
le bot crée des boutiques que le web ne verra jamais.

**Ce qui est déjà au niveau, et au-dessus.** L'intégrité de l'argent
(entiers, invariant SQL), le moteur de preuve (7 contrôles, unicité
réseau-large), le reçu opposable, la contre-signature à deux clés, les
machines pures testées — ce socle-là est plus rigoureux que la plupart des
acteurs du benchmark. Les tuyaux sont excellents ; ce sont les raccords qui
manquent.

---

## 6. Ce que ça donne en priorités

### P0 — rendre LA TRAVERSÉE possible (≈ 2,5 j)

1. **T9 — le suivi sait payer** : `/api/suivi` expose déjà `resteXaf` ; y
   ajouter le numéro de reversement (il est déjà public sur l'écran de
   paiement, lot 9) et faire porter à l'îlot le bloc rampe ou le lien
   `/payer?numero=&montant=` composé. ~1 j.
2. **T1 — le lien de l'app dans la bienvenue** et en réponse à « ma
   boutique ». ~0,25 j.
3. **T2 — la relance « posez votre reversement »** à J+1 via pg-boss (le
   patron de la relance d'acompte, à l'identique) — pointer vers l'app,
   jamais saisir dans le fil. ~0,5 j.
4. **T4 — router aussi par `seller.phone`**, pas seulement par
   `authUser.phoneNumber`. ~0,25 j.
5. **T7 — « menu » garde le panier** ; le changement de boutique prévient
   avant de vider. ~0,25 j.
6. **T10 — après « Confirmer », donner à l'acheteuse le geste suivant** :
   le wa.me de la vendeuse pré-rempli avec l'avis de versement
   (`messageVersement` existe, il attend d'être branché). ~0,25 j.

### P1 — lancer le volant (≈ 3 j)

- **T14 — « livrée CT-x » dans le fil vendeuse** (la machine est prête) —
  c'est le déclencheur qui débloque les avis.
- **T12/T13 — à la livraison, message à l'acheteuse** (fenêtre de service si
  <24 h ; sinon gabarit post-WABA) : reçu + invitation à noter — le seul
  moment où demander un avis coûte zéro.
- **T6 — reconstruction automatique de la boutique** sur écriture catalogue
  (débouncée) ou bascule des pages `[slug]` vers le rendu à la demande.
- **T5 — le stock gagne son champ** (fil : « stock 5 » sur un article ; app :
  champ replié comme la description) — ou l'affichage se retire.
- **T3 — le funnel d'activation mesuré** : compteurs par étape, mêmes règles
  que le lot 14.
- **T8 — « panier » montre les lignes.**

### P2 — post-WABA

Notification vendeuse à la commande ET au paiement reçu ; demande d'avis
J+7 en gabarit ; étapes de commande notifiées ; verdict des sept contrôles
dans le fil (dette ADR 0031, toujours le prochain gros morceau).

---

## 7. Sources

- Activation : [Mirakl — 2026 Seller Report](https://www.mirakl.com/blog/the-marketplace-revolution-key-insights-from-our-2026-seller-report) · [WC Vendors — onboarding vendeurs](https://www.wcvendors.com/onboarding-vendors-to-your-new-marketplace/) · [CS-Cart — seller onboarding](https://www.cs-cart.com/blog/marketplace-seller-onboarding/) · [Perspective — activation benchmarks 2026](https://getperspective.ai/blog/2026-customer-onboarding-benchmark-activation-rates-by-industry)
- Post-achat et avis : [Bloomreach — post-purchase flows](https://www.bloomreach.com/en/blog/perfect-post-purchase-emails-guide-examples-and-expert-tips) · [Digital Applied — post-purchase 2026](https://www.digitalapplied.com/blog/post-purchase-page-optimization-2026-ecommerce-revenue-guide) · [US Tech — reviews → catalogue](https://ustechautomations.com/resources/blog/automate-sync-product-reviews-to-the-catalog-2026)
- Conversationnel (analyses précédentes) : [Flows checkout](https://influencermarketinghub.com/whatsapp-flows-for-checkout/) · [TechTrendsKE — commerce WhatsApp Afrique](https://techtrendske.co.ke/2026/03/11/africa-whatsapp-commerce/) · [Kanal — récupération WhatsApp](https://getkanal.com/blog/whatsapp-vs-email-abandoned-cart-recovery)
