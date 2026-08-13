/**
 * Les cinq formulaires (Flows) a deposer chez Meta.
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
let WABA = process.env.WHATSAPP_WABA_ID?.trim();
const BASE = (process.env.WABOT_GRAPH_URL ?? "https://graph.facebook.com/v26.0").replace(/\/$/, "");
const mode = process.argv[2] ?? "--voir";

/**
 * Les cinq formulaires. `variable` est le nom a poser dans l'environnement
 * avec l'identifiant rendu : sans elle, le code reste dormant — c'est voulu.
 */
const FLUX = [
  {
    cle: "livraison",
    nom: "catalog_livraison",
    fichier: "docs/flux-livraison.json",
    variable: "WABOT_FLUX_LIVRAISON_ID",
    categories: ["OTHER"],
    /** Les champs que le domaine relira. Le contrat, en une ligne.
        `position` est la case a cocher : une INTENTION, pas une donnee de
        livraison. Meta n'a pas de composant de carte — mesure du 11/08/2026,
        addendum de l'ADR 0063 — donc la capture se fait par le message natif,
        juste apres le recapitulatif. */
    champs: ["ville", "quartier", "repere", "telephone", "position"],
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
    /**
     * L'OUVERTURE en deux ecrans — ADR 0087. Il remplace `inscription` quand
     * il est pose : boutique et ville sur le premier ecran, premier article
     * sur le second, et TOUT revient ensemble au `complete`. Meta le permet
     * sans point de terminaison (`navigate` puis `complete`, verifie dans la
     * documentation le 13/08/2026) — c'est ce qui fait tomber l'ouverture de
     * cinq messages a un formulaire.
     */
    cle: "ouverture",
    nom: "catalog_ouverture",
    fichier: "docs/flux-ouverture.json",
    variable: "WABOT_FLUX_OUVERTURE_ID",
    categories: ["SIGN_UP"],
    champs: ["boutique", "ville", "langue", "nom", "prix", "stock", "photo"],
  },
  {
    cle: "article",
    nom: "catalog_article",
    fichier: "docs/flux-article.json",
    variable: "WABOT_FLUX_ARTICLE_ID",
    categories: ["OTHER"],
    /** La photo est MESUREE (12/08/2026, mode --mesurer-photopicker de ce
        script : brouillon jetable 1713578936575692, aucune validation_error,
        supprime) : `PhotoPicker` est accepte sans point de terminaison.
        Facultative — la photo legendee dans le fil reste le geste le plus
        rapide, le formulaire ne l'exige pas. */
    champs: ["nom", "prix", "stock", "photo"],
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

async function exigerConfiguration() {
  if (!JETON) {
    console.error(
      "Variable absente : WABOT_API_KEY est exigee.\n" +
        "Voir .env.example, section « bot WhatsApp ».",
    );
    process.exit(1);
  }
  if (WABA) return;

  /**
   * ── `WHATSAPP_WABA_ID` absente : on la DEMANDE au jeton ─────────────────
   *
   * Constate le 12/08/2026, premiere execution DANS la machine Fly : les
   * depots de Flows avaient toujours ete faits depuis un poste, et personne
   * n'avait jamais pose le WABA sur l'application. Or le jeton SAIT a quel
   * compte il est rattache — `debug_token` rend les `target_ids` de ses
   * portees. Un identifiant que l'environnement connait deja par son jeton
   * n'a pas a etre recopie a la main.
   *
   * On ne devine RIEN : plusieurs comptes, ou aucun, c'est un arret franc —
   * deposer un Flow sur le mauvais WABA serait pire qu'echouer.
   */
  const reponse = await appel(`/debug_token?input_token=${encodeURIComponent(JETON)}`);
  const jeton = reponse?.data ?? {};
  const portees = jeton.granular_scopes ?? [];
  /* Les DEUX portees WhatsApp ciblent des WABA. Ne regarder que la premiere
     laissait echouer un jeton parfaitement utilisable dont seule la seconde
     porte la restriction d'actif. L'union ne relache rien : la regle « un seul
     compte, sinon on s'arrete » vaut toujours apres. */
  const cibles = new Set(
    portees
      .filter(
        (p) =>
          p?.scope === "whatsapp_business_management" || p?.scope === "whatsapp_business_messaging",
      )
      .flatMap((p) => p?.target_ids ?? []),
  );
  if (cibles.size !== 1) {
    console.error(
      cibles.size === 0
        ? "WHATSAPP_WABA_ID est absente, et le jeton ne designe AUCUN compte WhatsApp Business."
        : `WHATSAPP_WABA_ID est absente, et le jeton en designe ${cibles.size} — ` +
            "il en faut exactement un pour continuer sans risque de se tromper de WABA.",
    );
    /**
     * ── Ce que le jeton dit de lui-meme ─────────────────────────────────
     *
     * Constate le 12/08/2026 : « 0 compte(s) » ne dit pas LEQUEL des trois
     * cas on tient — jeton d'une autre application, portee WhatsApp jamais
     * accordee, ou portee accordee sans restriction d'actif (auquel cas Meta
     * ne rend aucun `target_ids`, et c'est normal). Les trois se corrigent
     * ailleurs. Une execution doit suffire a savoir lequel.
     *
     * Rien ici n'est un secret : le jeton n'est jamais reaffiche.
     */
    console.error("\nCe que le jeton dit de lui-meme :");
    console.error(`  valide       ${jeton.is_valid === true ? "oui" : "non"}`);
    console.error(`  type         ${jeton.type ?? "inconnu"}`);
    console.error(`  application  ${jeton.app_id ?? "inconnue"}`);
    console.error(`  portees      ${(jeton.scopes ?? []).join(", ") || "aucune"}`);
    if (portees.length === 0) {
      console.error("  actifs       aucune portee n'est restreinte a un actif");
    } else {
      for (const p of portees) {
        console.error(
          `  actifs       ${p?.scope} → ${(p?.target_ids ?? []).join(", ") || "aucun"}`,
        );
      }
    }
    console.error(
      "\nRemede : poser l'identifiant explicitement. Il se lit dans la console Meta,\n" +
        "WhatsApp > Configuration de l'API, champ « Identifiant du compte WhatsApp Business ».\n" +
        "  fly secrets set WHATSAPP_WABA_ID=<chiffres> --app catalog-api-preprod\n" +
        "Sans acces au poste : « Maintenance → poser-waba » le fait depuis l'integration continue.",
    );
    process.exit(1);
  }
  WABA = [...cibles][0];
  console.log(`WABA resolu depuis le jeton : ${WABA}`);
}

if (mode === "--voir") {
  console.log("\nLes cinq formulaires :\n");
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
  await exigerConfiguration();
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
  await exigerConfiguration();

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
         s'ouvre jamais. C'est l'oubli le plus couteux du parcours — et ce
         script l'a commis lui-meme le 11/08/2026.
    
         Le defaut : il ne publiait QUE si le Flow n'etait pas deja PUBLISHED.
         Or televerser une definition sur un Flow publie ne la met PAS en
         ligne — elle devient un brouillon. Une revision passait donc en
         silence : Meta continuait de servir l'ancienne, et le message
         « deja publie » affirmait le contraire.
    
         On publie donc TOUJOURS apres un televersement. Republier sans
         changement peut etre refuse par Meta ; ce refus-la est benin et se
         dit, il n'arrete pas le lot. */
      try {
        await appel(`/${id}/publish`, { method: "POST" });
        console.log("    publie");
      } catch (e) {
        console.log(
          `    publication non necessaire ou refusee : ${e instanceof Error ? e.message : e}`,
        );
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
} else if (mode === "--mesurer-photopicker") {
  await exigerConfiguration();

  /* La mesure du 11/08 (localisation), REJOUEE pour la photo : un formulaire
     JETABLE, jamais publie, dont on lit ce que Meta accepte ou refuse — puis
     le brouillon est supprime. Deux composants dans le meme ecran :
     `PhotoPicker` (la question) et un `TextInput` temoin — si le temoin est
     refuse aussi, c'est la definition qui est cassee, pas le composant.

     L'action est `complete` SANS point de terminaison : c'est exactement la
     forme du formulaire d'article, et c'est LA question posee. La doc Meta
     n'interdit PhotoPicker que dans `navigate` ; ce que ce script mesure,
     c'est ce que NOTRE WABA en dit vraiment (AGENTS.md §7.7 : on ne promeut
     rien sans mesure). */
  const NOM_ESSAI = "catalog_essai_photopicker";
  const essai = {
    version: "7.0",
    screens: [
      {
        id: "ESSAI",
        title: "Essai photo",
        terminal: true,
        data: {},
        layout: {
          type: "SingleColumnLayout",
          children: [
            {
              type: "Form",
              name: "formulaire",
              children: [
                {
                  type: "TextInput",
                  name: "temoin",
                  label: "Temoin",
                  required: false,
                  "input-type": "text",
                },
                {
                  type: "PhotoPicker",
                  name: "photo",
                  label: "Photo de l'article",
                  description: "Appareil photo ou galerie",
                  "photo-source": "camera_gallery",
                  "min-uploaded-photos": 0,
                  "max-uploaded-photos": 1,
                },
                {
                  type: "Footer",
                  label: "Envoyer",
                  "on-click-action": {
                    name: "complete",
                    payload: { temoin: "${form.temoin}", photo: "${form.photo}" },
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };

  const cree = await appel(`/${WABA}/flows`, {
    method: "POST",
    body: JSON.stringify({ name: NOM_ESSAI, categories: ["OTHER"] }),
  });
  console.log(`brouillon cree : ${cree.id}`);

  const formulaire = new FormData();
  formulaire.set("name", "flow.json");
  formulaire.set("asset_type", "FLOW_JSON");
  formulaire.set(
    "file",
    new Blob([JSON.stringify(essai)], { type: "application/json" }),
    "flow.json",
  );
  const envoi = await fetch(`${BASE}/${cree.id}/assets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${JETON}` },
    body: formulaire,
  });
  const reponse = await envoi.json().catch(() => null);

  console.log("\n── VERDICT DE LA MESURE ──");
  if (!envoi.ok) {
    console.log(
      `televersement refuse en bloc : HTTP ${envoi.status} ` +
        `${JSON.stringify(reponse?.error ?? reponse).slice(0, 300)}`,
    );
  } else if (reponse?.validation_errors?.length) {
    console.log("erreurs de validation (les lire UNE PAR UNE — le temoin distingue) :");
    for (const e of reponse.validation_errors) console.log(`  ${JSON.stringify(e)}`);
  } else {
    console.log(
      "AUCUNE erreur de validation : PhotoPicker est ACCEPTE dans un formulaire\n" +
        "`complete` sans point de terminaison, sur ce WABA, en Flow JSON 7.0.",
    );
  }

  /* Le brouillon ne survit pas a la mesure — comme le 11/08. */
  const suppression = await appel(`/${cree.id}`, { method: "DELETE" }).catch((e) => {
    console.log(`⚠ brouillon NON supprime (${e instanceof Error ? e.message : e}) — id ${cree.id}`);
    return null;
  });
  if (suppression) console.log(`brouillon supprime : ${cree.id}`);
} else {
  console.error(
    `mode inconnu : ${mode}. Utilisez --voir, --etat, --deposer ou --mesurer-photopicker.`,
  );
  process.exit(1);
}
