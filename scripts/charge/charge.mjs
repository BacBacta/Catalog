#!/usr/bin/env node
/**
 * Test de charge — le pic du 8 mars.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  LA CIBLE EST UNE HYPOTHESE. ELLE N'EST PAS MESUREE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Catalog n'a pas encore de trafic. Le « pic anticipe » du blueprint ne peut
 * donc pas etre lu quelque part : il se calcule a partir de nombres que
 * personne ne connait, et **inventer une valeur plausible est precisement ce
 * qu'AGENTS.md §7.7 interdit**. Le calcul est donc ecrit en toutes lettres
 * ci-dessous, avec ses entrees marquees comme des suppositions, pour qu'une
 * mesure reelle le remplace en une ligne le jour ou elle existe.
 *
 * ── Le calcul, entree par entree ───────────────────────────────────────────
 *
 * | entree | valeur | statut |
 * |---|---|---|
 * | vendeuses de la cohorte d'ouverture | 500 | **SUPPOSEE** |
 * | commandes par vendeuse le 8 mars | 20 | **SUPPOSEE** |
 * | part du jour concentree sur 4 heures | 100 % | **SUPPOSEE** |
 * | requetes d'API par commande | 8 | estimee, voir ci-dessous |
 *
 * 500 x 20 = 10 000 commandes ; concentrees sur quatre heures, cela fait
 * 2 500 commandes a l'heure, soit 0,7 par seconde. Chaque commande produit de
 * l'ordre de huit requetes d'API — une lecture de rampe, trois consultations du
 * suivi par l'acheteuse qui rafraichit, une contre-signature, un collage de SMS
 * par la vendeuse, deux consultations de recu — soit **5,6 requetes par
 * seconde**. La cible du blueprint est **trois fois le pic** : 17 req/s.
 *
 * Le chiffre est petit, et c'est l'information la plus utile de ce fichier. Ce
 * qui doit tenir le 8 mars n'est pas un volume : c'est une LATENCE sous charge
 * soutenue, avec une base qui grossit. Un test qui passerait a 17 req/s sans
 * regarder les percentiles ne prouverait rien.
 *
 * ── Pourquoi ce script n'ajoute aucune dependance ──────────────────────────
 *
 * `autocannon` ou `k6` feraient mieux. Ils ajouteraient aussi une dependance
 * qu'il faut auditer, mettre a jour et installer le jour d'un incident. Cent
 * lignes de Node lisibles tiennent le besoin : envoyer des requetes a un debit
 * choisi, et rendre des percentiles.
 *
 * ── Un detail qui invalide tout si on l'oublie ─────────────────────────────
 *
 * Depuis une seule machine, toutes les requetes portent la MEME adresse — et
 * la limitation de debit du lot 15 les refuserait a partir de 120 par minute.
 * On mesurerait alors la limitation, pas le service. Chaque utilisateur virtuel
 * porte donc un `X-Forwarded-For` distinct, ce qui est aussi la verite du
 * terrain : un pic du 8 mars, ce sont des milliers d'acheteuses distinctes.
 */

import { argv, env, exit } from "node:process";

/* ────────────────────────── la cible ────────────────────────── */

/** Le calcul ci-dessus, en code. Chaque constante porte son statut. */
export const MODELE = {
  vendeuses: 500, // SUPPOSEE
  commandesParVendeuse: 20, // SUPPOSEE
  heuresDePic: 4, // SUPPOSEE
  requetesParCommande: 8, // estimee a partir du parcours
  facteurDeSecurite: 3, // impose par le blueprint
};

export function cibleRps(m = MODELE) {
  const commandes = m.vendeuses * m.commandesParVendeuse;
  const parSeconde = commandes / (m.heuresDePic * 3600);
  return Math.ceil(parSeconde * m.requetesParCommande * m.facteurDeSecurite);
}

const option = (nom, defaut) => {
  const drapeau = argv.find((a) => a.startsWith(`--${nom}=`));
  return drapeau ? drapeau.slice(nom.length + 3) : (env[`CHARGE_${nom.toUpperCase()}`] ?? defaut);
};

const BASE = String(option("base", "http://127.0.0.1:8787")).replace(/\/$/, "");
const RPS = Number(option("rps", cibleRps()));
const DUREE_S = Number(option("duree", 20));
/** Percentile 95 tolere, en millisecondes. */
const P95_MAX_MS = Number(option("p95", 400));
/** Part d'erreurs toleree (hors 404 attendus). */
const ERREURS_MAX = Number(option("erreurs", 0.01));

/**
 * Les cles a interroger. Sans elles, le script tape des codes et des jetons
 * INEXISTANTS — et il le dit dans son rapport plutot que de laisser croire a une
 * mesure du chemin nominal.
 *
 * Le cout en base est comparable : la recherche porte sur une colonne unique
 * indexee, qu'elle trouve ou non. Ce qui change, c'est la serialisation de la
 * reponse et la seconde requete de date de contre-signature.
 */
const liste = (v) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const CODES = liste(option("codes", ""));
const JETONS = liste(option("jetons", ""));

/* ────────────────────────── le melange ────────────────────────── */

/**
 * Ce que l'API voit vraiment un jour de pic.
 *
 * **La boutique n'y figure pas**, et ce n'est pas un oubli : elle est statique
 * et servie par le CDN (ADR 0003). Le pic du 8 mars sur les pages d'articles ne
 * touche jamais ce serveur. Ce qui le touche, c'est le parcours de paiement et
 * de preuve — donc ce melange-ci.
 *
 * Les poids somment a 100 et suivent le calcul de l'en-tete : trois lectures de
 * suivi pour une contre-signature, deux consultations de recu, une lecture de
 * rampe.
 */
const MELANGE = [
  { poids: 12, nom: "rampe", requete: () => ({ chemin: "/api/rampe" }) },
  {
    poids: 38,
    nom: "suivi",
    requete: () => ({ chemin: `/api/suivi/${tire(JETONS) ?? faux(32)}` }),
  },
  {
    poids: 25,
    nom: "recu",
    requete: () => ({ chemin: `/api/recu/${tire(CODES) ?? "ACDE-4679"}` }),
  },
  { poids: 12, nom: "statut", requete: () => ({ chemin: "/api/statut" }) },
  {
    poids: 13,
    nom: "contresignature",
    requete: () => ({
      chemin: `/api/suivi/${tire(JETONS) ?? faux(32)}/contresigner`,
      methode: "POST",
    }),
  },
];

const tire = (t) => (t.length ? t[Math.floor(Math.random() * t.length)] : null);
const faux = (n) => "z".repeat(n);

const CUMUL = [];
{
  let somme = 0;
  for (const m of MELANGE) {
    somme += m.poids;
    CUMUL.push([somme, m]);
  }
}
const choisir = () => {
  const r = Math.random() * CUMUL[CUMUL.length - 1][0];
  return CUMUL.find(([s]) => r < s)[1];
};

/* ────────────────────────── l'execution ────────────────────────── */

const mesures = [];
let enVol = 0;
let maxEnVol = 0;

async function envoyer(scenario, adresse) {
  const { chemin, methode = "GET" } = scenario.requete();
  const debut = performance.now();
  enVol += 1;
  maxEnVol = Math.max(maxEnVol, enVol);
  try {
    const r = await fetch(`${BASE}${chemin}`, {
      method: methode,
      headers: {
        accept: "application/json",
        // Sans adresse distincte, on mesurerait la limitation de debit.
        "x-forwarded-for": adresse,
      },
    });
    // Le corps doit etre consomme, sinon la connexion reste ouverte et la
    // latence mesuree est celle de l'en-tete, pas celle de la reponse.
    await r.arrayBuffer();
    mesures.push({ scenario: scenario.nom, ms: performance.now() - debut, statut: r.status });
  } catch (e) {
    mesures.push({
      scenario: scenario.nom,
      ms: performance.now() - debut,
      statut: 0,
      erreur: String(e?.message ?? e),
    });
  } finally {
    enVol -= 1;
  }
}

function percentile(valeurs, p) {
  if (valeurs.length === 0) return 0;
  const tri = [...valeurs].sort((a, b) => a - b);
  return tri[Math.min(tri.length - 1, Math.ceil((p / 100) * tri.length) - 1)];
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function courir() {
  console.log(`Cible modelisee : ${cibleRps()} req/s (HYPOTHESE — voir l'en-tete du fichier)`);
  console.log(`Execution : ${RPS} req/s pendant ${DUREE_S} s sur ${BASE}`);
  if (CODES.length === 0 || JETONS.length === 0) {
    console.log(
      "Note : aucun code de verification ni jeton de suivi fourni. Les chemins /api/recu\n" +
        "et /api/suivi sont interroges avec des cles INEXISTANTES — la mesure porte sur la\n" +
        "recherche indexee, pas sur la serialisation d'un recu complet.\n" +
        "Fournir CHARGE_CODES et CHARGE_JETONS pour mesurer le chemin nominal.",
    );
  }

  const intervalleMs = 1000 / RPS;
  const fin = performance.now() + DUREE_S * 1000;
  const enCours = [];
  let n = 0;

  while (performance.now() < fin) {
    // Une adresse par utilisateur virtuel, sur mille : c'est ce qui rend la
    // mesure representative d'un pic reel plutot que d'une boucle locale.
    enCours.push(envoyer(choisir(), `10.${(n >> 16) % 256}.${(n >> 8) % 256}.${n % 256}`));
    n += 1;
    await dormir(intervalleMs);
  }
  await Promise.all(enCours);
  return n;
}

function rapport(envoyees) {
  const ms = mesures.map((m) => m.ms);
  const erreurs = mesures.filter((m) => m.statut === 0 || m.statut >= 500);
  const limitees = mesures.filter((m) => m.statut === 429);
  const partErreurs = mesures.length ? erreurs.length / mesures.length : 1;

  console.log(`\n${"─".repeat(64)}`);
  console.log(`Requetes envoyees : ${envoyees}   |   concurrence max : ${maxEnVol}`);
  console.log(
    `Latence   p50 ${percentile(ms, 50).toFixed(0)} ms   ` +
      `p95 ${percentile(ms, 95).toFixed(0)} ms   ` +
      `p99 ${percentile(ms, 99).toFixed(0)} ms   ` +
      `max ${Math.max(0, ...ms).toFixed(0)} ms`,
  );

  const parStatut = new Map();
  for (const m of mesures) parStatut.set(m.statut, (parStatut.get(m.statut) ?? 0) + 1);
  console.log(
    `Statuts   ${[...parStatut]
      .sort()
      .map(([s, n]) => `${s || "reseau"}:${n}`)
      .join("  ")}`,
  );

  for (const s of MELANGE) {
    const siens = mesures.filter((m) => m.scenario === s.nom).map((m) => m.ms);
    if (siens.length === 0) continue;
    console.log(
      `  ${s.nom.padEnd(16)} n=${String(siens.length).padStart(5)}  ` +
        `p95 ${percentile(siens, 95).toFixed(0)} ms`,
    );
  }

  /**
   * Une reponse 429 pendant un test de charge n'est PAS un succes silencieux :
   * elle veut dire qu'on a mesure la limitation de debit. Le dire fort evite de
   * lire un p95 flatteur qui ne mesure que des refus.
   */
  if (limitees.length > 0) {
    console.log(
      `\n  ATTENTION : ${limitees.length} reponse(s) 429. La limitation de debit a repondu\n` +
        "  a la place du service : ces mesures ne disent rien de sa tenue en charge.",
    );
  }
  if (erreurs.length > 0) {
    console.log(`\n  Erreurs : ${(partErreurs * 100).toFixed(2)} %`);
    for (const e of [...new Set(erreurs.map((x) => x.erreur).filter(Boolean))].slice(0, 3)) {
      console.log(`    ${e}`);
    }
  }

  const p95 = percentile(ms, 95);
  const echecs = [];
  if (p95 > P95_MAX_MS) echecs.push(`p95 ${p95.toFixed(0)} ms > ${P95_MAX_MS} ms`);
  if (partErreurs > ERREURS_MAX) {
    echecs.push(
      `erreurs ${(partErreurs * 100).toFixed(2)} % > ${(ERREURS_MAX * 100).toFixed(2)} %`,
    );
  }
  if (limitees.length > mesures.length * 0.05) echecs.push(`${limitees.length} reponses 429`);

  console.log(`${"─".repeat(64)}`);
  if (echecs.length > 0) {
    console.log(`ECHEC : ${echecs.join(" ; ")}`);
    return 1;
  }
  console.log("Seuils respectes.");
  return 0;
}

if (env.CHARGE_IMPORT !== "1") {
  const envoyees = await courir();
  exit(rapport(envoyees));
}
