# 0041 — Un site vérifiable : confidentialité et identité de l'éditeur

Date : 05/08/2026 · Statut : accepté · Complète : 0027, 0031

## Contexte

Le tableau de bord WhatsApp affiche : « Ce compte est en attente de la
vérification partenaire. 360Dialog doit vérifier votre entreprise avant que
vous puissiez commencer à envoyer des messages. **Si vous avez un site Web
valide, vous pouvez l'ajouter à votre profil pour commencer à envoyer des
messages dès maintenant.** »

Deux vérifications distinctes se confondent facilement, et les confondre fait
perdre des jours :

| | Qui | Ce qu'elle débloque | Ce qu'elle demande |
|---|---|---|---|
| **Vérification partenaire** | 360dialog | l'envoi, tout de suite | un site web valide |
| **Vérification d'entreprise** | Meta | gabarits, nom d'affichage validé, paliers | un document officiel au nom de l'entreprise |

La première est un raccourci offert. La seconde reste à faire, et **ne bloque
pas l'exploitation** : les conversations de service — tout ce que fait le bot —
sont illimitées et gratuites, vérifié ou non (runbook de bascule WABA).

Or ce que nous avions à déclarer était une page d'accueil honnête… **sans
politique de confidentialité, sans contact, sans identité d'éditeur**. Pour un
produit qui fait transiter des numéros de téléphone par WhatsApp, c'est la
première chose qu'un vérificateur ouvre — et la première chose qu'une
utilisatrice devrait trouver sans demander.

## Décision 1 — Une politique qui décrit le code, pas une intention

La page `/confidentialite` a été écrite **contre le schéma**, pas contre un
modèle trouvé ailleurs. Chaque affirmation correspond à une colonne ou à une
garde qui existe :

- le SMS collé est **chiffré au repos** (`payment_proof.rawSms`, lot 8) et
  n'apparaît dans aucune trace (ADR 0023) ;
- l'état de conversation s'efface après **24 h** sans échange
  (`INACTIVITE_MAX_MS`) et ne porte jamais de SMS ;
- les identifiants de messages entrants sont purgés à **trois jours**
  (ADR 0040) ;
- aucune donnée de carte, **jamais** le code secret mobile money, aucune
  adresse postale (AGENTS.md, ADR 0005) ;
- les fonds ne transitent par aucun compte à nous (ADR 0009).

**Une politique qui promet plus que le code ne tient serait pire que pas de
politique** : un engagement faux, vérifiable par quiconque lit l'application.
C'est la même discipline que pour le stock (ADR 0038) et la date de retour des
congés (ADR 0039) — on ne publie pas ce qu'on ne tient pas.

## Décision 2 — L'éditeur ne revendique aucune société

`apps/shop/src/lib/editeur.ts` porte le nom, le lieu et le contact, et **un
seul fichier les porte**. Le nom est « Catalog », sans mention de SARL ni de
registre de commerce.

Ce n'est pas une omission : écrire une entité qui n'existe pas serait faux sur
la page même qui sert à établir la confiance, et la vérification d'entreprise
de Meta exige un document officiel **au même nom**. Une incohérence à cet
endroit fait échouer la vérification et coûte un nouveau dossier.

Le jour où l'entité existe, c'est cette ligne qui change — et elle devra
correspondre exactement au nom d'affichage WhatsApp et au document fourni.

## Décision 3 — Le pied de page, parce qu'une page introuvable ne compte pas

Le lien vit sur la racine publique. Un vérificateur qui doit deviner une URL
conclut qu'elle n'existe pas.

## Ce que ça ne fait pas

- **Ça ne prend pas de domaine.** `vercel.app` et `fly.dev` sont sur la Public
  Suffix List : des hébergements partagés, pas des domaines d'entreprise. Le
  raccourci 360dialog peut s'en contenter ; la vérification Meta, beaucoup
  moins. C'est une décision et une dépense du porteur du produit — mais les
  pages sont prêtes à déménager, elles ne codent aucune URL en dur.
- **Ça ne change pas l'adresse de contact.** Elle reste celle du compte. Une
  adresse sur le domaine du produit prouverait le contrôle de ce domaine — à
  reprendre quand le domaine existera.
- **Ça n'écrit pas de conditions générales de vente.** Catalog n'est pas partie
  à la vente : la transaction lie l'acheteuse à la vendeuse, et les fonds ne
  nous touchent jamais. Rédiger des CGV donnerait à croire le contraire.
