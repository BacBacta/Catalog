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
 *
 * ── L'ORDRE, depuis l'ADR 0093 ────────────────────────────────────────────
 *
 * Les definitions declarent Flow JSON **7.3**, et cette version n'a pas encore
 * ete mesuree sur notre WABA. Les notes de 7.2 et 7.3 parlent de « validations
 * renforcees » : une definition que 7.0 tolerait peut y etre refusee.
 *
 *   1. `--mesurer-composants`  → son premier brouillon est un temoin nu ;
 *                                s'il passe, 7.3 est acceptee ici ;
 *   2. `--deposer`             → seulement ensuite.
 *
 * Temoin refuse : rejouer `--mesurer-composants 7.2`, puis `7.1`, et
 * redescendre les CINQ definitions a la version la plus haute acceptee —
 * `flux-version.test.ts` rend l'operation indivisible.
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
    /* La version DEPLOYEE — `flux-version.test.ts` le tient. Une sonde qui
       mesure une autre version que celle qu'on expedie ne dit rien de nous. */
    version: "7.3",
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
        `\`complete\` sans point de terminaison, sur ce WABA, en Flow JSON ${essai.version}.`,
    );
  }

  /* Le brouillon ne survit pas a la mesure — comme le 11/08. */
  const suppression = await appel(`/${cree.id}`, { method: "DELETE" }).catch((e) => {
    console.log(`⚠ brouillon NON supprime (${e instanceof Error ? e.message : e}) — id ${cree.id}`);
    return null;
  });
  if (suppression) console.log(`brouillon supprime : ${cree.id}`);
} else if (mode === "--mesurer-composants") {
  await exigerConfiguration();

  /**
   * ── La mesure des composants NON EMPLOYES — balayage du 13/08/2026 ──────
   *
   * La methode est celle de `--mesurer-photopicker`, etendue : pour CHAQUE
   * composant candidat, un brouillon JETABLE, jamais publie, avec un
   * `TextInput` temoin dans le meme ecran — si le temoin est refuse aussi,
   * c'est la definition (ou la version) qui est cassee, pas le composant.
   * Verdict lu dans `validation_errors`, brouillon supprime, ecran suivant.
   *
   * UN brouillon PAR composant, et non un brouillon a six ecrans : une erreur
   * de parse globale masquerait les cinq autres verdicts, et la mesure ne
   * vaudrait plus rien.
   *
   * ── Pourquoi la version se mesure D'ABORD ───────────────────────────────
   *
   * Nos cinq formulaires sont en Flow JSON 7.3 depuis l'ADR 0093 — migration
   * DECIDEE et non encore MESUREE : c'est cette sonde qui la valide. Les
   * schemas releves (sources SECONDAIRES — les pages Meta de ces composants
   * etaient inaccessibles le 13/08, HTTP 500) annoncent : NavigationList 6.2+,
   * ChipsSelector 6.3+, ImageCarousel 7.1+. Le premier brouillon ne porte donc
   * QUE le temoin, dans la version visee : s'il est refuse, tous les verdicts
   * suivants diraient « version » et non « composant » — et, depuis la
   * migration, il dit aussi si nos formulaires eux-memes passeraient.
   *
   * La version se passe en argument (defaut : 7.3) :
   *
   *   node apps/api/scripts/flux.mjs --mesurer-composants        → 7.3
   *   node apps/api/scripts/flux.mjs --mesurer-composants 7.1    → 7.1
   *
   * Chaque verdict — accepte OU refuse — s'ecrit dans un ADR avant toute
   * ligne de code qui en depend (AGENTS.md §7.7, methode de l'ADR 0087).
   */
  const VERSION_ESSAI = process.argv[3] ?? "7.3";

  /* 1×1 pixel PNG — le plus petit `src` possible. Si Meta exige une taille
     minimale d'image, l'erreur le DIRA, et c'est une mesure aussi. */
  const PIXEL =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const temoin = {
    type: "TextInput",
    name: "temoin",
    label: "Temoin",
    required: false,
    "input-type": "text",
  };
  const pied = (charge) => ({
    type: "Footer",
    label: "Envoyer",
    "on-click-action": { name: "complete", payload: { temoin: "${form.temoin}", ...charge } },
  });
  const formulaire = (enfants, charge = {}) => ({
    type: "Form",
    name: "formulaire",
    children: [...enfants, temoin, pied(charge)],
  });

  /**
   * Les candidats, chacun avec la QUESTION qu'il pose. `horsFormulaire` porte
   * les composants d'affichage (ils vivent a cote du formulaire, pas dedans).
   */
  const CANDIDATS = [
    {
      cle: "temoin",
      question: `la version ${VERSION_ESSAI} elle-meme — celle que nos cinq formulaires declarent`,
      horsFormulaire: [],
      dansFormulaire: [],
    },
    {
      cle: "richtext",
      question: "RichText (5.1+ annonce) : un recapitulatif lisible DANS un formulaire",
      horsFormulaire: [
        { type: "RichText", text: ["# Recapitulatif", "Article 1 × 2 : **15 000 FCFA**"] },
      ],
      dansFormulaire: [],
    },
    {
      cle: "si",
      question: "If et Switch (4.0+ annonces) : livraison OU retrait dans UN ecran",
      donnees: {
        montrer: { type: "boolean", __example__: true },
        mode: { type: "string", __example__: "livraison" },
      },
      horsFormulaire: [
        {
          type: "If",
          condition: "${data.montrer}",
          /* `then` est le nom EXACT de la propriete du composant If chez Meta —
             ce n'est pas un thenable, et le renommer casserait la mesure. */
          // biome-ignore lint/suspicious/noThenProperty: schema Flow JSON impose
          then: [{ type: "TextBody", text: "Visible si vrai" }],
          else: [{ type: "TextBody", text: "Visible sinon" }],
        },
        {
          type: "Switch",
          value: "${data.mode}",
          cases: {
            livraison: [{ type: "TextBody", text: "Quartier, repere, telephone" }],
            retrait: [{ type: "TextBody", text: "Le point de rendez-vous" }],
          },
        },
      ],
      dansFormulaire: [],
    },
    {
      cle: "chips",
      question: "ChipsSelector (6.3+ annonce) : quantite ou variante en un tap",
      horsFormulaire: [],
      dansFormulaire: [
        {
          type: "ChipsSelector",
          name: "choix",
          label: "Combien ?",
          "max-selected-items": 1,
          "data-source": [
            { id: "1", title: "1" },
            { id: "2", title: "2" },
            { id: "3", title: "3 ou plus" },
          ],
        },
      ],
      charge: { choix: "${form.choix}" },
    },
    {
      cle: "navigation",
      question: "NavigationList (6.2+ annonce) : un catalogue navigable DANS le formulaire",
      horsFormulaire: [
        {
          type: "NavigationList",
          name: "catalogue",
          "list-items": [
            {
              id: "a1",
              "main-content": { title: "Robe wax", description: "15 000 FCFA" },
              "on-click-action": { name: "complete", payload: { choisi: "a1" } },
            },
            {
              id: "a2",
              "main-content": { title: "Sac en cuir", description: "8 000 FCFA" },
              "on-click-action": { name: "complete", payload: { choisi: "a2" } },
            },
          ],
        },
      ],
      dansFormulaire: [],
    },
    {
      cle: "carrousel",
      question: "ImageCarousel (7.1+ annonce) : feuilleter les photos d'un article",
      horsFormulaire: [
        {
          type: "ImageCarousel",
          images: [
            { src: PIXEL, "alt-text": "Photo 1" },
            { src: PIXEL, "alt-text": "Photo 2" },
          ],
        },
      ],
      dansFormulaire: [],
    },
    {
      cle: "calendrier",
      question:
        "CalendarPicker (6.1+, donne `data_exchange` SEULEMENT) : la doc dit non — notre WABA ?",
      horsFormulaire: [],
      dansFormulaire: [
        { type: "CalendarPicker", name: "date", label: "Jour de la remise", mode: "single" },
      ],
      charge: { date: "${form.date}" },
    },
  ];

  const verdicts = [];
  for (const c of CANDIDATS) {
    const nomEssai = `catalog_essai_${c.cle}`;
    console.log(`\n════ ${nomEssai} — ${c.question} ════`);
    const essai = {
      version: VERSION_ESSAI,
      screens: [
        {
          id: "ESSAI",
          title: "Essai composant",
          terminal: true,
          data: c.donnees ?? {},
          layout: {
            type: "SingleColumnLayout",
            children: [...c.horsFormulaire, formulaire(c.dansFormulaire, c.charge ?? {})],
          },
        },
      ],
    };

    let brouillonId = null;
    try {
      const cree = await appel(`/${WABA}/flows`, {
        method: "POST",
        body: JSON.stringify({ name: nomEssai, categories: ["OTHER"] }),
      });
      brouillonId = cree.id;
      console.log(`brouillon cree : ${brouillonId}`);

      const donnees = new FormData();
      donnees.set("name", "flow.json");
      donnees.set("asset_type", "FLOW_JSON");
      donnees.set(
        "file",
        new Blob([JSON.stringify(essai)], { type: "application/json" }),
        "flow.json",
      );
      const envoi = await fetch(`${BASE}/${brouillonId}/assets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${JETON}` },
        body: donnees,
      });
      const reponse = await envoi.json().catch(() => null);

      if (!envoi.ok) {
        verdicts.push({ cle: c.cle, verdict: "REFUS EN BLOC", detail: `HTTP ${envoi.status}` });
        console.log(
          `televersement refuse : ${JSON.stringify(reponse?.error ?? reponse).slice(0, 300)}`,
        );
      } else if (reponse?.validation_errors?.length) {
        verdicts.push({
          cle: c.cle,
          verdict: "ERREURS",
          detail: reponse.validation_errors.map((e) => e?.message ?? JSON.stringify(e)).join(" | "),
        });
        console.log("erreurs de validation (le temoin distingue la definition du composant) :");
        for (const e of reponse.validation_errors) console.log(`  ${JSON.stringify(e)}`);
      } else {
        verdicts.push({
          cle: c.cle,
          verdict: "ACCEPTE",
          detail: `Flow JSON ${VERSION_ESSAI}, complete sans endpoint`,
        });
        console.log("AUCUNE erreur de validation : ACCEPTE sur ce WABA.");
      }
    } catch (e) {
      verdicts.push({
        cle: c.cle,
        verdict: "ECHEC D'APPEL",
        detail: e instanceof Error ? e.message : String(e),
      });
      console.log(`echec d'appel : ${e instanceof Error ? e.message : e}`);
    } finally {
      if (brouillonId) {
        const suppr = await appel(`/${brouillonId}`, { method: "DELETE" }).catch((e) => {
          console.log(
            `⚠ brouillon NON supprime (${e instanceof Error ? e.message : e}) — id ${brouillonId}`,
          );
          return null;
        });
        if (suppr) console.log(`brouillon supprime : ${brouillonId}`);
      }
    }
  }

  console.log("\n══════ RESUME DE LA MESURE ══════");
  console.log(`Flow JSON vise : ${VERSION_ESSAI}\n`);
  for (const v of verdicts) {
    console.log(`  ${v.cle.padEnd(12)} ${v.verdict.padEnd(14)} ${v.detail.slice(0, 140)}`);
  }
  if (verdicts[0]?.verdict !== "ACCEPTE") {
    console.log(
      `\n⚠ Le TEMOIN est refuse : la version ${VERSION_ESSAI} ne passe pas sur ce WABA.` +
        "\n  Les autres verdicts ne disent rien des composants — rejouer avec une version plus basse :" +
        `\n  node apps/api/scripts/flux.mjs --mesurer-composants 7.0`,
    );
  }
  console.log(
    "\nChaque verdict s'ecrit dans un ADR — accepte ou refuse — avant toute ligne de code qui en depend.",
  );
} else {
  console.error(
    `mode inconnu : ${mode}. Utilisez --voir, --etat, --deposer, --mesurer-photopicker ou --mesurer-composants.`,
  );
  process.exit(1);
}
