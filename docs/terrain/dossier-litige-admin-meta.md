# Dossier de litige administrateur Meta (Admin Dispute)

> Procédure officielle : « Envoyer une demande pour obtenir le contrôle total
> d'un portefeuille business ». Elle couvre exactement notre cas —
> *« La personne qui détient le contrôle total du portefeuille business est
> décédée et vous pouvez fournir un certificat de décès »* n'est pas le
> nôtre, mais *« Personne n'a le contrôle total du portefeuille business »*
> l'est.
>
> Établi le 16/08/2026. Les valeurs techniques sont **mesurées** (voir
> `diagnostic-meta.mjs`) ; le reste est à compléter par le porteur.

## Les trois pièces exigées

| # | Pièce | État |
|---|---|---|
| 1 | Document d'identité de la personne demandant l'accès | à fournir |
| 2 | Document prouvant la propriété de l'entreprise | à fournir |
| 3 | **Attestation signée** | modèle ci-dessous |

Format : **PDF, JPEG ou PNG**, non modifiés, non recadrés.

### Pièce 1 — identité

Passeport, pièce d'identité officielle, ou permis de conduire. Le nom doit
correspondre **exactement** au signataire de l'attestation.

### Pièce 2 — propriété de l'entreprise

Un seul de ces documents suffit, au nom de **Horizon Services Sarl** :

- certificat de constitution ou **statuts de la société** *(le plus simple)*
- licence commerciale ou autorisation d'activité
- avis d'imposition ou attestation fiscale
- relevé récapitulatif ou lettre bancaire
- facture d'eau ou d'électricité au nom de l'entreprise
- document indiquant la dénomination sociale

> Les statuts de la SARL sont généralement la pièce la plus rapide à réunir
> et la plus difficile à contester.

---

## Pièce 3 — l'attestation, à recopier sur papier à en-tête

> **En-tête obligatoire** : nom de l'entreprise, adresse physique, numéro de
> téléphone, et logo ou sceau officiel. Sans en-tête, Meta refuse.
>
> **Signature obligatoire** : manuscrite ou tampon numérique certifié, et
> **visible** sur le document.

```
[EN-TÊTE : logo Horizon Services Sarl]
Horizon Services Sarl
[Adresse physique complète]
[Numéro de téléphone]

                                            [Ville], le [date]

Objet : demande de contrôle total du portefeuille business
        Horizon Services Sarl — ID 1549278773267455

À l'attention du service d'assistance Meta,

Je soussigné(e) [PRÉNOM NOM], [fonction — gérant / représentant légal] de la
société Horizon Services Sarl, sollicite l'attribution du contrôle total du
portefeuille business identifié ci-dessus.

LIEN AVEC L'ENTREPRISE ET LE PORTEFEUILLE

Je suis [gérant / représentant légal] de Horizon Services Sarl, société
propriétaire du portefeuille business ID 1549278773267455 et du compte
WhatsApp Business associé.

IDENTIFIANTS CONCERNÉS

  Portefeuille business : 1549278773267455 — Horizon Services Sarl
  Compte WhatsApp Business (WABA) : 27932621843070231
  Numéro professionnel : +32 451 05 51 44
  Application : 1404746664890890

COMPTE DEMANDANT LE CONTRÔLE TOTAL

  URL du profil Facebook : [URL du NOUVEAU compte]
  Adresse e-mail associée : [e-mail du NOUVEAU compte]
  Ce compte bénéficie de Meta Verified.

SITUATION ET MOTIF DE LA DEMANDE

Le portefeuille business ne compte plus aucun administrateur actif.

L'unique administrateur était le compte Facebook personnel de [PRÉNOM NOM du
compte désactivé], qui a été désactivé définitivement par Meta le
[date]. La demande d'examen déposée le 16 août 2026 a été rejetée, sans
possibilité de recours. Aucune autre personne ne disposait de droits
d'administration sur ce portefeuille.

En l'absence d'administrateur, la société ne peut plus administrer son propre
compte WhatsApp Business : ni gérer les modèles de messages, ni les
formulaires, ni les autorisations, ni le catalogue produit.

Le compte WhatsApp Business concerné n'a fait l'objet d'aucune restriction ni
d'aucun avertissement. À ce jour : vérification d'entreprise validée, examen
du compte approuvé, numéro connecté, note de qualité verte, aucune erreur de
santé signalée. Le service reste opérationnel et n'a jamais été interrompu.

Je demande donc la nomination du compte indiqué ci-dessus comme
administrateur du portefeuille business, afin que la société puisse à nouveau
administrer un actif dont elle est propriétaire.

DÉCLARATION DE SINCÉRITÉ

Je soussigné(e) [PRÉNOM NOM] certifie que les informations fournies dans la
présente attestation sont authentiques et exactes.


                                   [Signature manuscrite ou tampon certifié]

                                   [PRÉNOM NOM]
                                   [Fonction]
                                   Horizon Services Sarl
```

---

## Comment soumettre

1. **Se connecter avec le NOUVEAU compte** (celui qui a Meta Verified).
2. Aller sur l'**Accueil assistance** Meta Business.
3. **Démarrer une discussion**, et choisir le motif **« Litige admin Business
   Manager »**.
4. **Importer les trois pièces.**

### L'obstacle à anticiper

La page d'aide dit : *« Assurez-vous d'être connecté au compte Facebook
associé au portefeuille business. »* Ce compte est justement celui qui est
désactivé — c'est le cœur du problème.

Si un agent le reproche, la réponse tient en une phrase :

> « Le compte associé au portefeuille est précisément celui qui a été
> désactivé définitivement. C'est le motif même de ce litige administrateur :
> il n'existe plus aucun compte pouvant se connecter à ce portefeuille. »

C'est exactement la situation que cette procédure est censée traiter — Meta
la liste elle-même parmi ses cas d'usage : *« Personne n'a le contrôle total
du portefeuille business. »*

### Deux règles pendant l'échange

- **Ne pas contester la désactivation du compte personnel.** Elle est close.
  Le litige porte sur le **portefeuille**, qui appartient à la société.
- **Obtenir un numéro de dossier**, et le noter ici.

## Après l'obtention du contrôle

L'assistant Meta l'a confirmé : une fois un nouvel administrateur nommé, deux
voies s'ouvrent — garder ce portefeuille, ou migrer le numéro vers un
nouveau. Dans les deux cas, la suite est dans
`docs/runbooks/reconstruire-le-compte-meta.md`.

**Et dans les deux cas, le premier geste est le même** : ajouter un **second
administrateur**. C'est l'absence de cette ligne qui a causé toute cette
procédure.

## Suivi

| Date | Étape | Résultat |
|---|---|---|
| 16/08/2026 | Appel sur le compte personnel | rejeté, définitif |
| | Dossier de litige admin déposé | n° |
| | Réponse de Meta | |
