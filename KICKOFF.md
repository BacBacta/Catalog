# KICKOFF — lancer l'implémentation dans Claude Code

Tout ce qu'il faut faire, dans l'ordre. Compte une dizaine de minutes de mise en
place, puis un lot par session.

---

## 0. Avant tout — faire tourner les identifiants CamPay

Les identifiants du bac à sable ont circulé en clair : jeton permanent, clé
webhook, mot de passe. Ils sont toujours valides côté CamPay tant qu'ils n'ont
pas été régénérés.

Va sur ton tableau de bord CamPay et régénère l'application. Ça prend deux
minutes, et ça reste vrai même si l'agrégateur ne sert plus dans la v1 : un
jeton valide qui traîne est un jeton valide qui traîne.

C'est la seule action de cette page qui ne peut pas être déléguée à un agent.

---

## 1. Déposer les sept fichiers

Sur ta branche `claude/campay-api-integration-r6s83f`, aux emplacements exacts
suivants. **Ne colle rien d'autre, ne déplace rien d'autre.**

| Fichier livré | Destination dans le dépôt |
|---|---|
| `AGENTS.md` | `AGENTS.md` — remplace l'existant |
| `PROMPTS.md` | `PROMPTS.md` — remplace l'existant |
| `formats-sms-operateurs.md` | `docs/formats-sms-operateurs.md` — nouveau |
| `0009-v1-sans-agregateur.md` | `docs/adr/0009-v1-sans-agregateur.md` — nouveau |
| `0010-renommage-catalog.md` | `docs/adr/0010-renommage-catalog.md` — nouveau |
| `rampe-paiement.html` | `docs/terrain/rampe-paiement.html` — nouveau, c'est l'instrument du test USSD |
| `KICKOFF.md` | à la racine, ou nulle part — c'est ta feuille de route, pas celle de l'agent |

`CLAUDE.md` importe déjà `@AGENTS.md` : il n'y a rien à y toucher. C'est ce qui
fait que Claude Code lit le contrat à chaque session sans qu'on le lui demande.

**Ne committe pas.** Laisse-les dans l'arbre de travail : le lot 0 commence par
vérifier qu'ils sont bien là, puis produit un commit unique avec le reste de la
bascule. Si tu committes d'abord, l'agent trouvera un dépôt propre et son propre
critère de « commit unique » sera déjà faux.

---

## 2. Le premier prompt à coller

Ouvre une session Claude Code neuve à la racine du dépôt, et colle exactement
ceci :

```
Lis AGENTS.md, docs/adr/0009-v1-sans-agregateur.md,
docs/adr/0010-renommage-catalog.md et docs/formats-sms-operateurs.md avant toute
chose. Puis exécute le LOT 0 de PROMPTS.md — la bascule d'architecture et le
renommage — et rien d'autre.

Rappel du contrat : un lot par session. Ne commence aucun autre lot, même s'il
paraît trivial. Si quelque chose est ambigu ou manquant, arrête-toi et
demande-moi plutôt que d'inventer une valeur plausible.

À la fin, montre-moi la sortie de pnpm typecheck && pnpm lint && pnpm test &&
pnpm build, et la liste des fichiers que tu as touchés.
```

Le lot 0 ne construit rien. Il met le dépôt en accord avec les décisions : ADR
déposés, adaptateur CamPay endormi derrière un drapeau, test de garde qui échoue
si quelqu'un le rebranche, renommage Swap → Catalog, et vérification qu'aucun
secret ne traîne dans un fichier versionné.

Sur le renommage, un seul piège, et l'ADR 0010 le pose noir sur blanc : le mot
« catalogue » désigne aussi le nom commun — la liste d'articles d'une vendeuse —
et il est déjà partout dans le code. Seul ce qui portait `swap` se renomme.

---

## 3. La séquence ensuite

Un lot par session, dans l'ordre. Pour chacun : ouvrir une session neuve, coller
le préambule de `PROMPTS.md` suivi du prompt du lot.

| | Lot | État |
|---|---|---|
| 0 | Bascule d'architecture et renommage | à faire en premier |
| 1 | Squelette et chaîne de qualité | ✅ déjà livré |
| 2 | Jetons de design et primitives UI | |
| 3 | Schéma de données et migrations | |
| 4 | Authentification par téléphone | |
| 5 | Articles et chaîne d'images | |
| 6 | Boutique publique Astro | |
| 7 | Domaine commande et preuve, sans réseau | |
| 8 | **Analyseurs de SMS et sept contrôles** | le cœur |
| 9 | Rampe de paiement | |
| 10 | Reçu vérifiable et contre-signature | |
| 11 | Cycle de vie des commandes | |
| 12 | Avis vérifiés | |
| 13 | Statistiques vendeuse | |
| 14 | Observabilité et runbooks | |
| 15 | Durcissement et mise en production | |

Vérifie toi-même la définition de terminé avant d'ouvrir la session suivante —
lance les commandes, regarde les captures. Un lot validé sur parole se paie deux
lots plus loin.

---

## 4. Ce qui se fait en parallèle, sur le terrain

Ni l'un ni l'autre ne bloque le développement. Les deux améliorent le produit
dès qu'ils arrivent.

**La capture Orange manquante.** Il faut le texte entier d'un SMS de réception
Orange Money — chez quelqu'un qui vient d'être payé. Sur la capture actuelle, le
message est coupé à « You have received 650 FCFA of… ». Un déroulement vers le
bas suffit. Tant qu'il manque, l'analyseur Orange de réception reste marqué « à
confirmer » et son verdict plafonne à « accepté sous réserve ».

**Le test des raccourcis USSD.** Les codes d'entrée sont confirmés — `*126#`
chez MTN, `#150*50#` chez Orange. Ce qu'on ne sait pas, c'est si une chaîne
complète saute les niveaux de menu. `docs/terrain/rampe-paiement.html` est déjà
l'instrument du test : ouvre-le sur un téléphone à Douala, appuie, note ce qui
s'affiche. Le lot 9 en produira la version intégrée à l'application ; cette page
autonome sert dès maintenant, sans attendre le lot.

Quand une capture arrive : mettre à jour `docs/formats-sms-operateurs.md`
**d'abord**, puis le code, puis les fixtures. Ce fichier est la source, le code
en découle.

---

## 5. Ce à quoi il faut être attentif

**Le lot 8 est celui qui compte.** C'est la valeur numéro un du produit, et
c'est aussi le lot où un agent est le plus tenté de « simplifier » une
expression régulière qu'il trouve laide. Elles sont laides parce que la réalité
l'est : espace avant la parenthèse fermante, numéro à douze chiffres d'un côté
et neuf de l'autre, trois libellés différents pour le même champ chez le même
opérateur, et l'anglais. Si une session propose de nettoyer un motif, demande
d'abord de rejouer les fixtures.

**L'adaptateur CamPay ne doit pas repartir.** Le lot 0 pose un test de garde
exprès. S'il saute un jour, ce n'est pas un détail de propreté : c'est
l'architecture qui dérive.

**Le mot « garanti » n'a rien à faire dans l'interface.** Catalog ne garantit pas
un paiement. Il rend un identifiant vérifiable auprès de l'opérateur, apporté
par la personne dont l'argent est en jeu, et contresigné par l'autre partie.
C'est plus honnête, et c'est plus solide que ce que l'agrégateur proposait —
dont la signature, elle, n'attestait rien du tout.
