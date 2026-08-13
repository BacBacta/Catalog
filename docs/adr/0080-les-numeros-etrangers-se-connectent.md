# 0080 — Les numéros étrangers se connectent : la diaspora vend au Cameroun

- **Statut** : accepté
- **Date** : 13/08/2026
- **Révise** : l'ADR 0058 (banc d'essai hors Cameroun), sur la porte de
  connexion par WhatsApp et elle seule.

## Le défaut qui a fait surface

Le banc d'essai du 13/08 : le porteur du produit, numéro belge, envoie son
message « Connexion Catalog : … » au bot — et rien. Pas d'erreur, pas de
refus : `appliquerMessageEntrant` ignorait tout numéro hors Cameroun, sauf
ceux nommés dans `BANC_ESSAI_NUMEROS_HORS_CM`. La règle faisait ce qu'on lui
avait dit de faire. C'est ce qu'on lui avait dit qui était trop étroit.

## La décision

Une commerçante à Bruxelles ou à Paris tient une boutique livrée à Douala.
Son WhatsApp est belge ou français, ses clientes sont camerounaises, son
argent arrive sur un Mobile Money camerounais. Ce profil n'est pas un cas de
test : c'est un segment.

**La porte de connexion par WhatsApp accepte donc tout numéro plausible**
(6 à 15 chiffres, la borne E.164) :

- c'est **Meta qui atteste le numéro** (`wa_id`) — exactement la même
  garantie que pour un +237 ; la porte étrangère n'est pas moins sûre que la
  camerounaise, elle repose sur le même témoin ;
- un numéro qui **commence par 237 sans être un camerounais valide reste
  refusé** : la porte camerounaise est `normalizePhone`, et le guichet
  étranger ne doit pas devenir le trou de la porte nationale.

## Ce qui ne change PAS

- **Le numéro de reversement reste camerounais.** Les rails Mobile Money
  (Orange Money, MTN MoMo) sont camerounais — c'est structurel, pas une
  préférence (AGENTS.md §2).
- **L'OTP par SMS reste sur le canal camerounais.** Orange Cameroun ne livre
  pas en Belgique ; la porte des numéros étrangers est la connexion par
  WhatsApp, qui n'a pas besoin de SMS.
- **Le banc d'essai (ADR 0058) demeure**, pour ce qui reste fermé aux
  numéros étrangers : servir de numéro de reversement pendant un test.

## Ce qu'on s'interdit d'en conclure

Ouvrir la connexion n'ouvre pas le produit aux boutiques *livrées* hors du
Cameroun : le contexte (pas d'adresse, repère + téléphone, XAF entier,
rampe USSD) reste camerounais de bout en bout.
