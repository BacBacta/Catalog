# 0064 — On ne conteste pas un paiement qui n'existe pas

Date : 2026-08-11
Statut : accepté
Corrige : une case du tableau de transitions du lot 7 (ADR 0018)
Concerne : `domain/proof/machine.ts`, `routes/recu.ts`, `domain/bot/notifications.ts`

## Le retour de terrain

Après le premier essai réussi du formulaire de livraison, le porteur du
produit signale : *« une fois la commande passée le flow est mort côté
vendeur… côté acheteur le flow est mort également, aucun moyen de suivre la
commande jusqu'à la fin et donner un avis »*.

Les fonctions existaient pourtant — l'app vendeuse fait avancer les étapes, le
fil accepte « livrée CT-… », la page de suivi répond. Le diagnostic a donc
porté sur les **données réelles** de la commande CT-471811, pas sur le code.

## Ce que le journal a dit

```
10:08:17  commande_creee   par acheteuse
10:08:47  preuve_avancee   par acheteuse  attendu → conteste
                                          « Contestation depuis le lien de suivi »
```

**Trente secondes.** Une commande `sans_prepaiement`, sur laquelle rien
n'avait été versé ni déclaré, est passée en litige — et un litige ferme tout :
plus de contre-signature, plus d'avis, reçu refusé, aucun retour possible.

Le parcours n'était pas mort. **Il avait été tué par un bouton qui n'aurait
pas dû être là.**

## Le défaut, à deux endroits

**Dans la machine** (lot 7) : la contestation était acceptée depuis
**n'importe quel** état sauf `conteste`. Le commentaire d'origine justifiait
la règle par le contrôle n° 7 — « la preuve la plus forte reste contestable,
sinon une collusion à deux voix serait définitive ». C'est juste, et ça le
reste ; mais la règle dépassait son intention : elle couvrait aussi l'état où
il n'y a **rien** à contester.

**Dans la route de suivi** : `contester: proofState !== "conteste"` affichait
donc le bouton sur une commande sans le moindre paiement.

## La décision

**Contester exige un paiement attribué.**

| État de départ | Contestation |
|---|---|
| `attendu` — rien versé, rien déclaré | **refusée** (`contestation_sans_paiement`) |
| `declare_non_trace` — la vendeuse affirme avoir reçu | acceptée |
| `prouve` | acceptée |
| `contresigne` | acceptée — le contrôle 7 ne bouge pas |
| `conteste` | refusée (`recul_ignore`), comme avant |

C'est la **seule** case du tableau qui change depuis le lot 7.

« Contester » veut dire *« ce paiement n'est pas de moi »*. Sur `attendu`,
personne n'a rien versé : l'acheteuse qui appuie veut dire tout autre chose —
se raviser, annuler, comprendre — et le produit lui faisait signer un litige.

Dès qu'un versement est **attribué**, le désaveu retrouve son objet. Y compris
sur `declare_non_trace` : quelqu'un affirme avoir reçu de l'argent, et
l'acheteuse doit pouvoir le démentir.

## Le refus se dit

Cacher un bouton ne suffit pas : la route restait ouverte. Le domaine refuse
**et** l'API répond en français simple. Un `409` nu n'apprend rien à une
acheteuse, et le silence sur ce qui vient d'échouer est précisément ce qui
fait croire que le produit est cassé :

> Aucun paiement n'a encore été enregistré sur cette commande — il n'y a donc
> rien à contester. Si vous voulez annuler, écrivez-le à la vendeuse : c'est
> elle qui peut le faire.

Les autres refus de la machine gagnent leur phrase au passage.

## Le second reproche : la notification était une impasse

Côté vendeuse, tout existait mais **rien n'y menait**. La notification de
nouvelle commande annonçait un fait et s'arrêtait là : ni le mot-clé de
remise, ni le chemin vers les étapes intermédiaires. Le seul lien qu'elle
portait concernait le reversement.

Elle se termine désormais par ce qui suit :

```
Quand c'est remis, écrivez ici : livrée CT-471811
Préparée, chez le livreur, historique : <espace vendeuse>/commandes
```

La référence est **écrite** : un mot-clé à taper de tête est une friction, un
mot-clé écrit est un copier-coller. Sans espace configuré, la ligne
disparaît — jamais de lien mort.

## Ce que cet ADR ne fait PAS

- **Il ne réanime pas CT-471811.** Un litige ne se défait pas par une
  migration : `payment_proof` et `order_event` sont en ajout seul, et rouvrir
  un litige par script serait exactement le geste qu'aucun code ne doit
  pouvoir faire. La commande du banc reste en l'état, comme témoin.
- **Il n'ouvre pas l'annulation à l'acheteuse.** Le message la renvoie à la
  vendeuse, qui a le geste. Donner à l'acheteuse un bouton d'annulation est
  une décision produit — celle qu'on vient de payer pour avoir prise trop
  vite dans l'autre sens.

## Conséquences

- 9 tests neufs, dont trois vus rouges d'abord.
- Deux tests du lot 7 **mis à jour, pas supprimés** : ils affirmaient
  « TOUT état → conteste », ce qui était vrai et ne l'est plus. La case du
  tableau porte la raison du changement.
