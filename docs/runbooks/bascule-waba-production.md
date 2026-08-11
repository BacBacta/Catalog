# Bascule du bac à sable vers le WABA de production

> Ce fichier n'est **pas** un runbook d'incident : il se lit **une fois**, le
> jour où 360dialog livre le canal de production, comme `deploiement.md`. À la
> fin, le numéro Catalog est un vrai numéro, les médias fonctionnent, et le
> bac à sable ne sert plus.

## Ce que le terrain du 05/08/2026 a établi — à lire avant tout

Une tentative de bascule a eu lieu ce jour-là. Elle n'a pas abouti, et **ce
n'est pas un échec technique** : le blocage est administratif, et il est en
amont de tout ce que décrit ce runbook.

### Le verrou : la vérification d'entreprise Meta

> « Si votre numéro est en statut *Pending*, cela signifie que Meta est encore
> en train de vérifier votre WABA. Pendant cette période, **aucun numéro ne
> peut être enregistré ou utilisé**. » — support 360dialog

Tant que la vérification d'entreprise n'est pas passée, un numéro ajouté au
WABA reste « En attente » et **aucun bouton ne le débloque**. Inutile de
chercher une action dans la fiche du numéro : il n'y en a pas.

C'est donc le **chemin critique**, et non une formalité de fin de parcours
comme le laissait entendre la section « Après la bascule ».

### Un numéro ne se remplace pas, et l'abonnement le suit

Trois règles confirmées par le support, qui coûtent de l'argent si on les
découvre tard :

- **Un numéro de test Meta (`+1 555…`) ne peut jamais être échangé** contre un
  numéro réel. Il faut inscrire le nouveau numéro par l'Embedded Signup, puis
  cesser d'utiliser l'ancien.
- **Les abonnements sont liés au numéro et ne se transfèrent pas.** Ouvrir un
  canal sur le vrai numéro **ajoute** une facturation ; celle du numéro de test
  se résilie à la main, sans quoi elle court pour rien.
- **Ni les données ni l'historique** ne suivent d'un numéro à l'autre.

### Ce qu'un numéro de test permet, et où il s'arrête

Le support a écrit que « le test ne se fait pas via l'application WhatsApp ».
**C'est trompeur** : ce qui est vrai, c'est qu'on ne peut pas installer
WhatsApp Business *sur* le numéro de test. Le destinataire, lui, utilise son
WhatsApp ordinaire — c'est exactement le montage du produit.

La vraie borne est ailleurs : **un numéro de test ne livre qu'aux 5
destinataires inscrits** dans le tableau de bord développeur. Et quand le WABA
est détenu par le partenaire, ce tableau de bord n'est pas accessible au
client — la liste devient donc inatteignable.

Symptôme à connaître : **l'API répond `HTTP 200` avec un `wamid`, et le message
n'arrive jamais.** L'envoi est accepté, la livraison est bloquée en aval. Un
contrôle qui ne regarde que le code HTTP conclut à tort que tout va bien.

### Ce qui est acquis et n'est pas à refaire

| Fait | Comment il a été établi |
|---|---|
| L'envoi fonctionne | `POST waba-v2.360dialog.io/messages` → `200` + `wamid` |
| `WABOT_BASE_URL` **sans `/v1`** | même appel, en production |
| La route entrante est montée | `/api/whatsapp/entrant/<faux>` rend `{"erreur":"inconnu"}` là où un chemin inexistant rend `404 Not Found` en texte brut |
| Le webhook du canal est configuré | *Channel Webhook URL* + en-tête `Authorization` |

Le jour où le canal du vrai numéro existe, **il ne reste qu'à remplacer la clé**
et à repointer le webhook.

### La sonde qui distingue « route absente » de « secret faux »

Les deux rendent un 404. Seul le CORPS les sépare :

```bash
curl -sS https://<api>/api/nexistepas                      # → 404 Not Found       (texte brut)
curl -sS https://<api>/api/whatsapp/entrant/nimportequoi   # → {"erreur":"inconnu"} (notre JSON)
```

Le second prouve que `WHATSAPP_ENTRANT_SECRET` **et** `WHATSAPP_APP_SECRET`
sont posées : sans les deux, la route n'est pas enregistrée du tout.

---

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
