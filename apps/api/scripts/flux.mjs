/**
 * Les trois formulaires (Flows) a deposer chez Meta.
 *
 *   node apps/api/scripts/flux.mjs             → les affiche et les valide
 *   node apps/api/scripts/flux.mjs --etat      → dit lesquels existent deja
 *   node apps/api/scripts/flux.mjs --deposer   → les cree, televerse, publie
 *
 * ── Pourquoi ce script existe ─────────────────────────────────────────────
 *
 * Un Flow se cree en QUATRE appels — creation, televersement de la definition,
 * publication, puis lecture de l'identifiant. Fait a la main dans la console,
 * trois fois de suite, c'est trois occasions de se tromper de WABA ou d'oublier
 * la publication (un Flow en brouillon s'envoie sans erreur et ne s'ouvre
 * jamais). Ici, c'est une commande.
 *
 * ── Ce qu'il exige ────────────────────────────────────────────────────────
 *
 * Le transport META. L'API de notre ancienne cle 360dialog n'exposait PAS les
 * Flows (mesure le 08/08/2026 : `/v1/configs/flows`, `/v2/flows`, `/v1/flows`
 * rendent 404) — c'est ce qui avait laisse l'ADR 0055 a moitie fait. Depuis la
 * bascule en direct chez Meta (ADR 0046), le chemin existe.
 *
 * `--deposer` est un acte SORTANT et durable. Il ne part jamais tout seul.
 */
import { readFileSync } from "node:fs";

const JETON = process.env.WABOT_API_KEY?.trim();
const WABA = process.env.WHATSAPP_WABA_ID?.trim();
const BASE = (process.env.WABOT_GRAPH_URL ?? "https://graph.facebook.com/v26.0").replace(/\/$/, "");
const mode = process.argv[2] ?? "--voir";

/**
 * Les trois formulaires. `variable` est le nom a poser dans l'environnement
 * avec l'identifiant rendu : sans elle, le code reste dormant — c'est voulu.
 */
const FLUX = [
  {
    cle: "livraison",
    nom: "catalog_livraison",
    fichier: "docs/flux-livraison.json",
    variable: "WABOT_FLUX_LIVRAISON_ID",
    categories: ["OTHER"],
    /** Les champs que le domaine relira. Le contrat, en une ligne. */
    champs: ["ville", "quartier", "repere", "telephone"],
  },
  {
    cle: "inscription",
    nom: "catalog_inscription",
    fichier: "docs/flux-inscription.json",
    variable: "WABOT_FLUX_INSCRIPTION_ID",
    categories: ["SIGN_UP"],
    champs: ["boutique", "ville", "langue"],
  },
  {
    cle: "avis",
    nom: "catalog_avis",
    fichier: "docs/flux-avis.json",
    variable: "WABOT_FLUX_AVIS_ID",
    categories: ["SURVEY"],
    champs: ["note", "mot"],
  },
];

function definition(f) {
  return JSON.parse(readFileSync(new URL(`../../../${f.fichier}`, import.meta.url), "utf8"));
}

/**
 * Verifie que la definition promet bien les champs que le domaine relit.
 *
 * C'est le seul controle qui compte hors ligne : un formulaire dont un champ
 * a ete renomme se depose sans erreur, s'ouvre sans erreur, et rend une
 * reponse que `lireReponseFlux` refusera EN SILENCE — l'acheteuse verrait sa
 * question se re-poser sans comprendre.
 */
function verifier(f) {
  const brut = JSON.stringify(definition(f));
  const manquants = f.champs.filter((c) => !brut.includes(`"${c}"`));
  return manquants;
}

async function appel(chemin, options = {}) {
  const r = await fetch(`${BASE}${chemin}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${JETON}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const corps = await r.json().catch(() => null);
  if (!r.ok) {
    const message = corps?.error?.error_user_msg ?? corps?.error?.message ?? `HTTP ${r.status}`;
    throw new Error(message);
  }
  return corps;
}

function exigerConfiguration() {
  if (!JETON || !WABA) {
    console.error(
      "Variables absentes : WABOT_API_KEY et WHATSAPP_WABA_ID sont exigees.\n" +
        "Voir .env.example, section « bot WhatsApp ».",
    );
    process.exit(1);
  }
}

if (mode === "--voir") {
  console.log("\nLes trois formulaires :\n");
  for (const f of FLUX) {
    const manquants = verifier(f);
    const ecrans = definition(f)
      .screens.map((e) => e.id)
      .join(", ");
    console.log(`  ${f.nom}  (${f.categories.join(", ")})`);
    console.log(`    fichier  ${f.fichier}`);
    console.log(`    ecrans   ${ecrans}`);
    console.log(`    champs   ${f.champs.join(", ")}`);
    console.log(`    variable ${f.variable}`);
    console.log(
      manquants.length === 0
        ? "    contrat  OK — la definition promet ce que le domaine relit"
        : `    contrat  ROMPU — champs absents de la definition : ${manquants.join(", ")}`,
    );
    console.log("");
  }
  console.log("Pour deposer : node apps/api/scripts/flux.mjs --deposer\n");
} else if (mode === "--etat") {
  exigerConfiguration();
  const liste = await appel(`/${WABA}/flows`);
  const parNom = new Map((liste.data ?? []).map((f) => [f.name, f]));
  console.log("");
  for (const f of FLUX) {
    const existant = parNom.get(f.nom);
    console.log(
      existant
        ? `  ${f.nom} : ${existant.status} — id ${existant.id}\n    ${f.variable}=${existant.id}`
        : `  ${f.nom} : absent`,
    );
  }
  console.log("");
} else if (mode === "--deposer") {
  exigerConfiguration();

  /* Le contrat d'abord : rien ne part si un champ relu par le domaine manque
     de la definition. */
  for (const f of FLUX) {
    const manquants = verifier(f);
    if (manquants.length > 0) {
      console.error(`${f.nom} : champs absents de la definition — ${manquants.join(", ")}`);
      process.exit(1);
    }
  }

  const liste = await appel(`/${WABA}/flows`);
  const parNom = new Map((liste.data ?? []).map((f) => [f.name, f]));
  const poses = [];

  for (const f of FLUX) {
    const existant = parNom.get(f.nom);
    let id = existant?.id;
    try {
      if (!id) {
        const cree = await appel(`/${WABA}/flows`, {
          method: "POST",
          body: JSON.stringify({ name: f.nom, categories: f.categories }),
        });
        id = cree.id;
        console.log(`  ${f.nom} : cree (${id})`);
      } else {
        console.log(`  ${f.nom} : existe deja (${id})`);
      }

      /* Le televersement passe par un multipart : la definition est un
         FICHIER pour Meta, pas un corps JSON. */
      const formulaire = new FormData();
      formulaire.set("name", "flow.json");
      formulaire.set("asset_type", "FLOW_JSON");
      formulaire.set(
        "file",
        new Blob([JSON.stringify(definition(f))], { type: "application/json" }),
        "flow.json",
      );
      const envoi = await fetch(`${BASE}/${id}/assets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${JETON}` },
        body: formulaire,
      });
      const reponse = await envoi.json().catch(() => null);
      if (!envoi.ok) {
        const detail = reponse?.error?.error_user_msg ?? reponse?.error?.message;
        throw new Error(`televersement refuse : ${detail ?? `HTTP ${envoi.status}`}`);
      }
      if (reponse?.validation_errors?.length) {
        console.log(`    validation : ${JSON.stringify(reponse.validation_errors)}`);
      }
      console.log("    definition televersee");

      /* La publication : sans elle, le Flow s'ENVOIE sans erreur et ne
         s'ouvre jamais. C'est l'oubli le plus couteux du parcours. */
      if (existant?.status !== "PUBLISHED") {
        await appel(`/${id}/publish`, { method: "POST" });
        console.log("    publie");
      } else {
        console.log("    deja publie — la nouvelle definition remplace l'ancienne");
      }
      poses.push([f.variable, id]);
    } catch (e) {
      console.error(`  ${f.nom} : ECHEC — ${e instanceof Error ? e.message : e}`);
    }
  }

  if (poses.length > 0) {
    console.log("\nA poser en secrets Fly, puis redeployer :\n");
    console.log(
      `  fly secrets set ${poses.map(([v, id]) => `${v}=${id}`).join(" ")} --app catalog-api-preprod\n`,
    );
  }
} else {
  console.error(`mode inconnu : ${mode}. Utilisez --voir, --etat ou --deposer.`);
  process.exit(1);
}
