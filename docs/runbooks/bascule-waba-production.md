# Bascule du bac à sable vers le WABA de production

> Ce fichier n'est **pas** un runbook d'incident : il se lit **une fois**, le
> jour où 360dialog livre le canal de production, comme `deploiement.md`. À la
> fin, le numéro Catalog est un vrai numéro, les médias fonctionnent, et le
> bac à sable ne sert plus.

## Ce qu'il faut avoir en main

Depuis le Hub 360dialog, une fois le canal approuvé :

- **la clé d'API de production** (elle n'a rien à voir avec celle du bac à
  sable — l'ancienne continue de vivre sa vie) ;
- **le numéro de production**, au format international.

## La contrainte à connaître AVANT de commencer

**Un numéro ne sert qu'un seul environnement à la fois.** Le webhook du canal
360dialog pointe vers une URL et une seule : préproduction *ou* production,
jamais les deux. La séquence recommandée est donc de le faire pointer d'abord
vers la **préproduction**, d'y dérouler le contrôle de bon fonctionnement, puis
de le rebasculer vers la production. Entre les deux, le bot de préproduction
devient muet — c'est normal, et c'est réversible en une minute.

## Les quatre variables, et celle qu'on oublie

| Variable | Bac à sable | Production |
|---|---|---|
| `WABOT_API_KEY` | clé du bac à sable | **clé du Hub** |
| `WABOT_BASE_URL` | `https://waba-sandbox.360dialog.io/v1` | **`https://waba-v2.360dialog.io`** (sans `/v1`) |
| `WHATSAPP_WABA_NUMERO` | numéro du bac à sable | **le numéro de production** |
| `WABOT_WEBHOOK_AUTH` | inchangé, ou renouvelé | idem |

**`WHATSAPP_WABA_NUMERO` n'est pas décoratif** : c'est lui qui fabrique **tous**
les liens `wa.me` — lien de boutique, lien de parrainage, lien partagé en
Statut. Oublié, chaque vendeuse reçoit un lien qui pointe vers l'ancien numéro,
et aucune cliente n'arrive. Ces liens sont recalculés à chaque message (rien
n'est figé en base), donc la correction est immédiate — mais les messages
**déjà envoyés** portent l'ancien lien pour toujours.

## Les actions, dans l'ordre

**1. Poser les secrets** (les valeurs ne s'affichent jamais dans un terminal
partagé) :

```bash
flyctl secrets set --app catalog-api-preprod \
  WABOT_API_KEY="…" \
  WABOT_BASE_URL="https://waba-v2.360dialog.io" \
  WHATSAPP_WABA_NUMERO="+237…"
```

La machine redémarre seule. Sans `WABOT_API_KEY`, le bot ne se monte pas du
tout — c'est le garde de l'ADR 0031, et il vaut mieux qu'un bot muet.

**2. Configurer le webhook du canal** dans le Hub 360dialog (ou par leur API
de configuration) : l'URL entrante `…/api/whatsapp/entrant/<secret>` et
l'en-tête `Authorization` valant `WABOT_WEBHOOK_AUTH`. Les livraisons relayées
par 360dialog **ne portent pas de signature Meta** ; c'est cet en-tête qui fait
office de verrou, et la route l'accepte uniquement en l'absence de signature.

**3. Vérifier que le canal parle** — un message sortant vers votre propre
numéro suffit ; s'il arrive, la clé et la base sont bonnes.

**4. Vérifier que le canal entend** — écrivez `menu` depuis WhatsApp. Si rien
n'arrive, ce sont les journaux qui tranchent : la route trace le motif du refus
sans jamais recopier de contenu.

```bash
flyctl logs --app catalog-api-preprod | grep "livraison entrante refusee"
```

`signature=false en-tete=false` veut dire que le relais n'envoie pas l'en-tête
configuré ; `signature=true` refusé veut dire que `WHATSAPP_APP_SECRET` ne
correspond pas à l'app Meta.

**5. Rejouer le parcours complet**, et surtout **la photo** : c'est le seul
chemin qui ne pouvait pas être vérifié en bac à sable (aucun endpoint média).
Envoyez une photo légendée « nom prix » et vérifiez que l'article se publie
**avec** son image. Si elle manque, l'adaptateur a dégradé proprement — le
diagnostic est dans `apps/api/src/adapters/whatsapp-media.ts`, qui applique la
réécriture d'hôte exigée par 360dialog.

## Critère de sortie

Trois faits, pas deux :

1. un message envoyé arrive sur un vrai téléphone ;
2. un message reçu déclenche une réponse du bot ;
3. **un article créé depuis le fil porte sa photo** — c'est ce qui atteste que
   la chaîne média entière fonctionne, du téléchargement au ré-encodage sous
   100 Ko.

## Retour arrière

Reposer les deux variables du bac à sable et remettre le webhook du canal
sandbox à son URL. Aucune donnée n'est perdue : les conversations et les
boutiques vivent en base, indépendamment du canal qui les a portées.

## Après la bascule

- Le bac à sable peut rester configuré : il ne coûte rien et sert de banc
  d'essai pour les changements de copie.
- La **vérification d'entreprise** reste à faire pour débloquer les gabarits
  (relances au-delà de 24 h, diffusions) et le nom d'affichage validé. Elle ne
  bloque **pas** l'exploitation : les conversations de service — tout ce que
  fait le bot — sont illimitées et gratuites, vérifié ou non.
- Le plan est facturé **par numéro**. Tant que toutes les boutiques partagent
  le numéro Catalog, c'est un coût de plateforme unique ; chaque numéro dédié
  du palier « Pro » ajoutera sa licence, et c'est le chiffre qui devra fonder
  la tarification de ce palier.
