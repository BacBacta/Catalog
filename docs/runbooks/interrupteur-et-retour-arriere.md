# Interrupteur d'arrêt et retour arrière

**Symptôme générique :** quelque chose vient de partir en production et ça va
mal. Ce runbook ne diagnostique rien — il donne les deux gestes qui arrêtent
l'hémorragie, dans l'ordre où on les fait.

> **La règle qui prime sur tout le reste : on arrête d'abord, on comprend
> ensuite.** Un interrupteur se remet en position ouverte en dix secondes. Une
> demi-heure passée à diagnostiquer pendant que des paiements se perdent ne se
> rattrape pas.

---

## 1. L'interrupteur d'arrêt

### Les trois positions

| Position | Écritures | Lecture des reçus et du suivi | Quand |
|---|---|---|---|
| `ouvert` | oui | oui | normal |
| `lecture_seule` | **non** | **oui** | **le choix par défaut en cas de doute** |
| `ferme` | non | non | doute sur l'intégrité des données |

**`lecture_seule` est la position à prendre neuf fois sur dix.** Un reçu est une
preuve opposable : une acheteuse le montre, un litige se tranche avec. Le faire
disparaître en même temps qu'on coupe les écritures transforme un incident
technique en incident de confiance — et c'est la valeur numéro un du produit qui
tombe, précisément le jour où on en a besoin.

`ferme` ne se justifie que si l'on soupçonne les données elles-mêmes : servir un
reçu peut-être faux est alors pire que n'en servir aucun. Cette décision
s'écrit dans le journal d'incident, avec son motif.

### Basculer — deux chemins, deux vitesses

**Chemin rapide (dix secondes, sans redéploiement) :**

```bash
echo lecture_seule > "$INTERRUPTEUR_FICHIER"   # ex. /run/catalog/interrupteur
```

Le fichier est relu toutes les deux secondes. Aucun redémarrage, aucun
déploiement, aucune chaîne d'outils à faire marcher — c'est exactement pour
cela qu'il existe : les jours où l'on coupe sont les jours où l'on n'est sûr
de rien.

**Chemin durable (survit au redémarrage) :**

```bash
INTERRUPTEUR=lecture_seule   # variable d'environnement, puis redémarrage
```

Le fichier gagne sur la variable. Un fichier absent ou vide n'est pas une
erreur : on retombe sur la variable.

### Vérifier que c'est fait

```bash
curl -s "$API/api/statut" | jq '{niveau, service, recusConsultables, operationsPossibles}'
```

Attendu en `lecture_seule` :

```json
{ "niveau": "degrade", "service": "lecture_seule",
  "recusConsultables": true, "operationsPossibles": false }
```

Puis, à la main, les deux gestes qui comptent :

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$API/api/recu/<un-code-connu>"   # 200 attendu
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/suivi/<jeton>/contresigner"  # 503 attendu
```

### Prévenir

Écrire le message d'incident **avant** de partir diagnostiquer. Il s'affiche sur
`/statut`, la page publique, qui est servie par le CDN et reste debout même si
l'API est morte.

```bash
STATUT_MESSAGE="Interruption depuis 14 h 10. Vos reçus restent consultables.
Les paiements déjà faits ne sont pas perdus : l'argent est allé directement
chez votre vendeuse."
```

Ne jamais y écrire d'heure de reprise qu'on n'est pas sûr de tenir. Une heure
ratée coûte plus cher que pas d'heure du tout.

### Rouvrir

```bash
echo ouvert > "$INTERRUPTEUR_FICHIER"
```

**Critère de sortie :** `/api/statut` rend `niveau: "ok"`, une contre-signature
de test passe, et le message d'incident est vidé (`STATUT_MESSAGE=""`).

---

## 2. Le retour arrière

### Ce qui se rembobine, et ce qui ne se rembobine pas

| Élément | Rembobinable | Comment |
|---|---|---|
| API (`apps/api`) | oui | redéploiement de l'image précédente |
| Boutique (`apps/shop`) | oui | le CDN garde les déploiements précédents |
| App vendeuse (`apps/seller`) | oui, avec un délai | **voir l'avertissement ci-dessous** |
| Migration de base | **non** | voir « migrations » |

#### L'app vendeuse a un service worker, et il retarde le retour arrière

Un service worker déjà installé sert l'ancienne version jusqu'à sa prochaine
mise à jour. Concrètement : après un retour arrière, une vendeuse qui a ouvert
l'app peut continuer à voir la version fautive pendant un moment. Le retour
arrière du code n'est donc **pas** immédiat côté vendeuse — l'interrupteur, lui,
l'est, parce qu'il agit sur l'API que toutes les versions appellent.

C'est une raison de plus de basculer l'interrupteur d'abord.

#### Les migrations ne se rembobinent pas, et c'est voulu

Le dépôt migre en **expand / contract** (AGENTS.md §6) : on ajoute, on
double-écrit, on migre les lectures, on retire. La conséquence pratique est que
**l'ancienne version du code fonctionne sur le nouveau schéma** — c'est tout
l'intérêt, et c'est ce qui rend le retour arrière du code sûr sans toucher à la
base.

Donc : **on ne « défait » jamais une migration pour revenir en arrière.** On
revient en arrière sur le code seul. Si le retour arrière du code ne suffit pas
parce qu'une migration a détruit quelque chose, ce n'était pas une migration
expand/contract, et on est dans le cas de la restauration —
[restauration-sauvegarde.md](restauration-sauvegarde.md).

### La procédure

1. **Interrupteur en `lecture_seule`.** Toujours en premier.
2. Noter la version fautive : `curl -s "$API/api/statut" | jq -r .version`.
3. Redéployer la version précédente de l'API.
4. Vérifier :
   ```bash
   curl -s "$API/api/statut" | jq -r .version    # la version attendue
   curl -s -o /dev/null -w "%{http_code}\n" "$API/health"
   ```
5. Rejouer à la main le parcours qui avait cassé.
6. **Interrupteur en `ouvert`.**
7. Vider `STATUT_MESSAGE`.

**Critère de sortie :** la version servie est la précédente, le parcours fautif
passe, et les compteurs du lot 14 — en particulier
`catalog.preuve.controle{controle=1,etat=fail}` — sont revenus à leur niveau
d'avant l'incident. Ce dernier point compte : un service qui répond n'est pas un
service qui marche.

---

## 3. L'ouverture progressive par cohortes

Ce n'est pas un mécanisme d'incident, mais il se manipule avec les mêmes
variables et il sert au même but : borner les dégâts.

```bash
COHORTE_POURCENT=10                       # 10 % des vendeuses peuvent écrire
COHORTE_PILOTES="vendeuse_abc,vendeuse_def"   # toujours admises, quel que soit le %
```

Trois propriétés à connaître avant de toucher au chiffre :

- **Élargir n'exclut jamais.** Une vendeuse admise à 10 % l'est encore à 20 %,
  à 50 % et à 100 %. La cohorte est calculée par un hachage de l'identifiant,
  pas par un tirage : c'est ce qui rend l'élargissement sans danger pour les
  personnes déjà entrées.
- **Réduire le pourcentage, en revanche, EXCLUT** des vendeuses qui étaient
  dedans. Ce n'est pas un geste d'incident — pour arrêter, on utilise
  l'interrupteur, qui est franc et lisible. Réduire une cohorte laisse une
  partie du réseau dehors sans savoir pourquoi.
- **Aucune lecture n'est jamais bloquée.** Une vendeuse hors vague voit son
  catalogue, ses commandes et ses statistiques ; seules les écritures sont
  retenues, avec un message qui le dit. Et le parcours **acheteuse** n'est
  jamais filtré : une acheteuse ne choisit pas sa vendeuse en fonction de nos
  vagues, et lui refuser la contre-signature casserait le contrôle n° 7 pour
  une raison qui ne la regarde pas.

Vérifier qui est dedans, sans deviner :

```bash
# Le seau d'une vendeuse (0 à 99). Elle est dans la vague si seau < COHORTE_POURCENT.
node -e 'import("./apps/api/src/domain/deploiement/ouverture.ts").then(m =>
  console.log(m.seauDe(process.argv[1])))' <identifiant-vendeuse>
```

---

## 4. Ce que l'interrupteur ne fait pas

À dire tout haut, pour ne pas s'en apercevoir pendant un incident :

- **Il n'arrête pas les paiements.** Catalog n'initie aucun transfert et ne
  détient aucun fonds (ADR 0006, ADR 0009). Une acheteuse qui compose son code
  USSD paie sa vendeuse, interrupteur ouvert ou fermé. Ce qui s'arrête, c'est
  l'enregistrement de la preuve — pas l'argent.
- **Il ne coupe pas la boutique publique.** Elle est statique et servie par le
  CDN. Les pages d'articles restent en ligne ; seuls les îlots qui appellent
  l'API (rampe, reçu, suivi) affichent leur état d'erreur.
- **Il ne suspend pas les travaux de fond** (pg-boss : expiration de commandes,
  rappels de solde). Si le doute porte sur eux, il faut les arrêter séparément.
- **Il n'est pas partagé entre instances.** Le fichier est local à la machine :
  avec plusieurs instances, il faut le poser sur chacune, ou passer par la
  variable d'environnement et un redéploiement.
