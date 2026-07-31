import type { CheckResult, OperatorKey, ProofState, Verdict } from "@catalog/contracts";
import { metrics } from "@opentelemetry/api";
import { NOM_SERVICE } from "./traces.ts";

/**
 * Les quatre mesures que le lot 14 met sous alerte.
 *
 * Elles ne sont pas choisies pour faire un joli tableau de bord. Chacune repond
 * a une question qu'on se posera dans la panique, et la premiere repond a la
 * panne la PLUS PROBABLE de ce produit.
 *
 * ── 1. Taux de preuves refusees, par controle et par operateur ─────────────
 *
 * **Une bascule soudaine sur le controle n° 1 signale un CHANGEMENT DE FORMAT
 * chez l'operateur.** C'est la panne la plus probable de Catalog, et elle est
 * silencieuse : rien ne tombe, aucune erreur 500, aucune alerte
 * d'infrastructure. Les vendeuses collent leurs SMS comme d'habitude et se font
 * refuser en bloc, et elles ne rappelleront pas — elles arreteront de coller.
 * Le seul signal est celui-ci, et c'est pour cela qu'il est ventile PAR
 * OPERATEUR : un changement de format touche MTN ou Orange, jamais les deux le
 * meme jour. Un taux global melangerait les deux et diviserait le signal par
 * deux au moment ou il faut le voir.
 *
 * ── 2. Part des commandes en `declare_non_trace` ───────────────────────────
 *
 * Le contournement, vu de l'autre bout. L'ecran statistiques du lot 13 le montre
 * a la vendeuse ; ce compteur-ci le montre a l'exploitant, en fenetre glissante,
 * pour tout le reseau.
 *
 * ── 3. Delai entre commande et preuve ──────────────────────────────────────
 *
 * Un histogramme, pas une moyenne. La moyenne d'un delai est toujours mentie par
 * la queue ; c'est la mediane qu'on regarde, et il faut des seaux pour l'avoir.
 * Les bornes vont de la minute a la fenetre de 48 h du controle n° 4 : au-dela,
 * la commande a expire et le delai ne veut plus rien dire.
 *
 * ── 4. Tentatives de reutilisation d'un identifiant ────────────────────────
 *
 * Le controle n° 5, vu comme un signal de securite et non comme un refus. Une
 * hausse soudaine, c'est quelqu'un qui essaie — et c'est reseau-large, donc une
 * seule vendeuse qui rejoue chez plusieurs autres se voit ici et nulle part
 * ailleurs.
 *
 * ── Ce qu'aucune mesure ne porte ───────────────────────────────────────────
 *
 * **Aucun montant, aucun solde, aucun numero.** Meme regle que les traces, et
 * meme raison : une metrique se garde plus longtemps qu'une trace, et ses
 * etiquettes se lisent par plus de monde.
 */

const metre = () => metrics.getMeter(NOM_SERVICE);

/* ────────────────────────── 1. controles ────────────────────────── */

const controles = () =>
  metre().createCounter("catalog.preuve.controle", {
    description: "Resultat de chaque controle de preuve, par numero et par operateur.",
  });

/**
 * Un point par CONTROLE, pas un par preuve.
 *
 * Une preuve refusee compte un `fail` sur le controle qui l'a refusee et un
 * `pass` sur ceux qu'elle avait franchis. Sans cette ventilation, « les refus
 * augmentent » ne dit pas OU, et c'est exactement ce qu'il faut savoir : un
 * refus sur le n° 2 est un sous-paiement, sur le n° 4 une horloge, sur le n° 1
 * un changement de format. Trois pannes qui n'ont rien a voir.
 */
export function mesurerControles(
  checks: readonly CheckResult[],
  operateur: OperatorKey | "inconnu",
): void {
  const c = controles();
  for (const check of checks) {
    c.add(1, { controle: check.n, etat: check.state, operateur });
  }
}

/**
 * Le controle n° 1 en echec sans motif reconnu.
 *
 * Ce cas n'a pas d'operateur — c'est justement ce qui le definit : aucun motif
 * ne s'est apparie. Il compte sous `inconnu`, et c'est CE compteur qui bascule
 * quand un operateur change son format.
 */
export function mesurerFormatNonReconnu(raison: string): void {
  controles().add(1, { controle: 1, etat: "fail", operateur: "inconnu", raison });
}

/* ────────────────────────── 2. etat de preuve ────────────────────────── */

const etats = () =>
  metre().createCounter("catalog.commande.etat_preuve", {
    description:
      "Transitions d'etat de preuve. La part de declare_non_trace mesure le contournement.",
  });

export function mesurerEtatPreuve(etat: ProofState): void {
  etats().add(1, { etat });
}

/* ────────────────────────── 3. delai ────────────────────────── */

const delais = () =>
  metre().createHistogram("catalog.preuve.delai_secondes", {
    description: "Delai entre la creation de la commande et la preuve acceptee.",
    unit: "s",
    advice: {
      /**
       * Des seaux, jusqu'a la fenetre de 48 h du controle n° 4. Au-dela, la
       * commande a expire et le delai ne mesure plus rien d'actionnable.
       */
      explicitBucketBoundaries: [60, 300, 900, 1800, 3600, 7200, 21_600, 43_200, 86_400, 172_800],
    },
  });

/**
 * Le delai, en secondes, entre la creation de la commande et la preuve.
 *
 * Les deux instants arrivent en PARAMETRES et ne sont pas lus ici : c'est la
 * meme discipline que le domaine, et elle rend cette mesure testable. Un delai
 * negatif — horloge de base en avance sur l'horloge d'application — n'est pas
 * enregistre : il polluerait la mediane sans rien apprendre.
 */
export function mesurerDelaiPreuve(commandeCreeeA: Date, preuveA: Date, verdict: Verdict): void {
  const secondes = (preuveA.getTime() - commandeCreeeA.getTime()) / 1000;
  if (!Number.isFinite(secondes) || secondes < 0) return;
  delais().record(secondes, { verdict });
}

/* ────────────────────────── 4. identifiants rejoues ────────────────────────── */

const rejoues = () =>
  metre().createCounter("catalog.preuve.identifiant_rejoue", {
    description: "Tentatives de reutilisation d'un identifiant d'operateur deja reclame.",
  });

/**
 * Un identifiant deja reclame, chez cette vendeuse ou chez une autre.
 *
 * L'identifiant lui-meme n'est PAS une etiquette. Deux raisons : sa cardinalite
 * est infinie, ce qui ferait exploser le cout de stockage des metriques ; et
 * c'est une donnee de transaction, qui n'a pas a se promener dans un systeme de
 * metriques. Pour enqueter sur un identifiant precis, on ouvre le journal
 * d'audit, qui est en ajout seul et qui est fait pour ca.
 */
export function mesurerIdentifiantRejoue(operateur: OperatorKey): void {
  rejoues().add(1, { operateur });
}

/* ────────────────────────── le filet, en metrique ────────────────────────── */

/**
 * Le nombre de valeurs que la redaction a retirees.
 *
 * **C'est une metrique d'alerte, pas de confort.** Elle doit rester a zero. Une
 * valeur non nulle veut dire qu'un chemin de code a failli envoyer un SMS chez
 * un tiers et que seul le filet l'a arrete — donc qu'il existe un defaut a
 * corriger, meme si rien n'a fuite.
 */
export function observerFuitesEvitees(compteur: { fuitesEvitees: number }): void {
  metre()
    .createObservableGauge("catalog.trace.fuites_evitees", {
      description: "Valeurs retirees des traces par la redaction. Doit rester a zero.",
    })
    .addCallback((r) => r.observe(compteur.fuitesEvitees));
}
