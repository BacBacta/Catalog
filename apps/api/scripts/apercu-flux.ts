/**
 * L'apercu local des Flows — il LIT `docs/flux-*.json` et les dessine.
 *
 *   node apps/api/scripts/apercu-flux.ts              → ecrit docs/terrain/apercu-flux.html
 *   node apps/api/scripts/apercu-flux.ts --sortie X    → ecrit ailleurs
 *   node apps/api/scripts/apercu-flux.ts --verifier    → n'ecrit rien, dit si le fichier est a jour
 *
 * ── Pourquoi ce script existe ─────────────────────────────────────────────
 *
 * Les maquettes de `docs/terrain/` sont ECRITES A LA MAIN. Elles montrent une
 * intention, et rien ne dit quand elles cessent de decrire les definitions
 * reellement deposees : une maquette peut promettre un champ que le JSON n'a
 * pas, et l'ecart ne se voit qu'a Douala, sur un vrai telephone.
 *
 * `flux-spec.test.ts` ferme cette derive pour les NOMS de champs. Ce script la
 * ferme pour ce qu'une vendeuse VOIT — titres, aides, ordre, obligation,
 * libelle du bouton, enchainement — parce qu'il ne connait aucune autre source
 * que le JSON lui-meme.
 *
 * ── Pourquoi en TypeScript, alors que `scripts/` est en .mjs ──────────────
 *
 * Parce qu'un test l'importe. En `.mjs`, `tsc` refuse l'import faute de
 * declarations (TS7016) et la seule issue serait un `.d.mts` ecrit a la main —
 * c'est-a-dire une seconde source de verite a maintenir, exactement ce que ce
 * script existe pour supprimer. Node 24 execute le TypeScript en RETIRANT les
 * types : pas de propriete de parametre, pas d'`enum`, pas de `namespace` —
 * voir `node-strip-only.test.ts`.
 *
 * ── Ce qu'il ne remplace PAS ──────────────────────────────────────────────
 *
 * L'apercu officiel de Meta (`POST /{flow-id}/preview`) rend le VRAI pixel.
 * Il exige un Flow existant chez Meta, donc l'administration du WABA — gelee
 * depuis le 16/08/2026, ADR 0109. Ici, le contenu est mesure et la chrome est
 * DESSINEE : la page le dit en toutes lettres plutot que de laisser croire
 * qu'un ecart de police est un ecart de produit.
 *
 * ── Le composant inconnu est BRUYANT ──────────────────────────────────────
 *
 * Un type absent de `COMPOSANTS` ne disparait pas : il rend un bloc rouge, et
 * `apercu-flux.test.ts` echoue. C'est la lecon de l'ADR 0105 — la panne muette
 * coute plus cher que la panne visible.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* ─────────────────────────── la forme du JSON ───────────────────────────── */

export interface Action {
  name: string;
  next?: { type: string; name: string };
  payload?: Record<string, string>;
}

/** Un noeud de `layout`. Les cles a tirets sont celles de Meta, telles quelles. */
export interface Noeud {
  type: string;
  name?: string;
  label?: string;
  text?: string;
  description?: string;
  required?: boolean;
  children?: Noeud[];
  "helper-text"?: string;
  "input-type"?: string;
  "photo-source"?: string;
  "min-uploaded-photos"?: number;
  "max-uploaded-photos"?: number;
  "data-source"?: Array<{ id: string; title: string }>;
  "on-click-action"?: Action;
}

export interface Ecran {
  id: string;
  title: string;
  terminal?: boolean;
  layout: Noeud;
}

export interface SpecFlux {
  version: string;
  screens: Ecran[];
}

export interface Flux {
  cle: string;
  spec: SpecFlux;
}

const ICI = dirname(fileURLToPath(import.meta.url));
export const RACINE = resolve(ICI, "../../..");
export const SORTIE_PAR_DEFAUT = join(RACINE, "docs/terrain/apercu-flux.html");

/**
 * L'ordre de LECTURE, qui est celui du parcours et non celui de l'alphabet :
 * on ouvre une boutique avant d'y ajouter un article, et on est paye avant
 * d'etre note.
 *
 * Un fichier absent de cette liste n'est pas ignore — il est ajoute a la fin.
 * Un Flow neuf qui n'apparaitrait pas serait exactement la panne muette que ce
 * script existe pour eviter.
 */
const ORDRE = ["ouverture", "inscription", "article", "reversement", "livraison", "avis"];

/** Ce que chaque Flow sert, en une ligne. Absente, la legende ne bloque rien. */
const LEGENDES: Record<string, string> = {
  ouverture:
    "Le premier contact d'une vendeuse : sa boutique et son premier article, en deux écrans.",
  inscription: "L'ouverture en un seul écran — le repli quand le Flow d'ouverture n'est pas posé.",
  article: "Un article de plus dans un catalogue déjà ouvert.",
  reversement: "Le numéro Mobile Money où l'argent arrive. Le champ qu'un attaquant viserait.",
  livraison: "Ce qui remplace l'adresse : ville, quartier, repère, téléphone.",
  avis: "L'avis vérifié, adossé à un paiement prouvé.",
};

/** Les trois natures de saisie que `input-type` peut porter, telles qu'écrites. */
const CLAVIERS: Record<string, string> = { text: "texte", number: "chiffres", phone: "téléphone" };

const ENTITES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Exporte, et pour une raison : le test cherche les textes du JSON dans la
 * page. Une seconde fonction d'echappement ecrite de son cote divergerait —
 * elle l'a fait, sur l'apostrophe droite de « d'autres », et le test accusait
 * le rendu d'un defaut qui etait le sien.
 */
export function echapper(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ENTITES[c] ?? c);
}
const ech = echapper;

/* ─────────────────────────── les composants ─────────────────────────────── */

type Rendu = (enfants: Noeud[] | undefined) => string;

export interface Composant {
  rendre: (n: Noeud, r: Rendu) => string;
}

export const COMPOSANTS: Record<string, Composant> = {
  SingleColumnLayout: { rendre: (n, r) => r(n.children) },
  Form: { rendre: (n, r) => r(n.children) },

  TextSubheading: { rendre: (n) => `<p class="sous-titre">${ech(n.text)}</p>` },
  TextBody: { rendre: (n) => `<p class="corps">${ech(n.text)}</p>` },

  TextInput: {
    rendre: (n) => `
      <label class="champ">
        <span class="etiquette">${ech(n.label)}${marqueObligatoire(n)}</span>
        <span class="saisie" data-clavier="${ech(clavier(n))}"></span>
        ${aide(n)}
      </label>`,
  },

  TextArea: {
    rendre: (n) => `
      <label class="champ">
        <span class="etiquette">${ech(n.label)}${marqueObligatoire(n)}</span>
        <span class="saisie longue"></span>
        ${aide(n)}
      </label>`,
  },

  RadioButtonsGroup: {
    rendre: (n) => `
      <fieldset class="champ groupe">
        <legend class="etiquette">${ech(n.label)}${marqueObligatoire(n)}</legend>
        ${(n["data-source"] ?? [])
          .map((o) => `<span class="option"><span class="rond"></span>${ech(o.title)}</span>`)
          .join("")}
        ${aide(n)}
      </fieldset>`,
  },

  OptIn: {
    rendre: (n) => `
      <span class="champ optin"><span class="case"></span>${ech(n.label)}</span>`,
  },

  PhotoPicker: {
    rendre: (n) => `
      <div class="champ photo">
        <span class="etiquette">${ech(n.label)}${marqueObligatoire(n)}</span>
        <div class="depot">
          <span class="appareil" aria-hidden="true">▣</span>
          <span>${ech(n.description ?? "")}</span>
        </div>
        <span class="aide">${ech(bornesPhoto(n))}</span>
      </div>`,
  },

  /**
   * Le pied n'est pas un composant de plus : c'est le SEUL geste qui fait
   * avancer un ecran, et son action porte la charge utile que le domaine
   * relira. On l'affiche donc entierement, cle par cle.
   */
  Footer: {
    rendre: (n) => `
      <div class="pied">
        <span class="bouton">${ech(n.label)}</span>
        <p class="mention">Géré par l'entreprise — dessiné, pas mesuré</p>
      </div>
      ${charge(n["on-click-action"])}`,
  },
};

const marqueObligatoire = (n: Noeud): string =>
  n.required === true ? ' <span class="obligatoire" title="obligatoire">•</span>' : "";

const aide = (n: Noeud): string =>
  n["helper-text"] ? `<span class="aide">${ech(n["helper-text"])}</span>` : "";

const clavier = (n: Noeud): string => {
  const t = n["input-type"];
  return (t ? CLAVIERS[t] : undefined) ?? t ?? "texte";
};

const bornesPhoto = (n: Noeud): string => {
  const min = n["min-uploaded-photos"] ?? 0;
  const max = n["max-uploaded-photos"] ?? 1;
  const source =
    n["photo-source"] === "camera_gallery" ? "appareil photo ou galerie" : n["photo-source"];
  return `${min === 0 ? "facultative" : `${min} minimum`}, ${max} au plus — ${source}`;
};

/** L'action du pied, rendue lisible : c'est le contrat avec le domaine. */
function charge(a: Action | undefined): string {
  if (!a?.name) return "";
  const payload = a.payload ?? {};
  const cles = Object.keys(payload);
  const nature =
    a.name === "complete"
      ? "termine et renvoie"
      : a.name === "navigate"
        ? `va vers <code>${ech(a.next?.name ?? "?")}</code> en portant`
        : `action <strong>${ech(a.name)}</strong> — non reconnue`;
  return `
    <details class="contrat">
      <summary>${nature} ${cles.length} champ${cles.length > 1 ? "s" : ""}</summary>
      <ul>${cles.map((c) => `<li><code>${ech(c)}</code> ← ${ech(payload[c])}</li>`).join("")}</ul>
    </details>`;
}

/* ─────────────────────────── la mesure ──────────────────────────────────── */

/**
 * Tous les types presents sous les `layout` d'une definition.
 *
 * On descend par `children` UNIQUEMENT, ce qui exclut deux faux positifs que
 * le premier inventaire avait releves : `type: "string"` des schemas `data`,
 * et `type: "screen"` de `next`. Ni l'un ni l'autre n'est un composant.
 */
export function typesUtilises(spec: SpecFlux): Set<string> {
  const vus = new Set<string>();
  const descendre = (n: Noeud): void => {
    vus.add(n.type);
    for (const enfant of n.children ?? []) descendre(enfant);
  };
  for (const ecran of spec.screens) descendre(ecran.layout);
  return vus;
}

export interface Mesure {
  obligatoires: number;
  facultatifs: number;
  taps: number;
  gestes: number;
}

/**
 * Le compte de GESTES — c'est la mesure du « premium » de ce produit, et non
 * l'aspect : `parcours-premium.html` compte les messages tapes, ici on compte
 * les champs a remplir avant que l'ecran laisse passer.
 *
 * Une case a cocher n'est jamais obligatoire chez Meta ; elle compte donc en
 * facultatif, comme le reste.
 */
export function mesurer(spec: SpecFlux): Mesure {
  let obligatoires = 0;
  let facultatifs = 0;
  let taps = 0;
  const descendre = (n: Noeud): void => {
    if (n.type === "Footer") taps += 1;
    else if (n.name !== undefined && n.type !== "Form") {
      if (n.required === true) obligatoires += 1;
      else facultatifs += 1;
    }
    for (const enfant of n.children ?? []) descendre(enfant);
  };
  for (const ecran of spec.screens) descendre(ecran.layout);
  return { obligatoires, facultatifs, taps, gestes: obligatoires + taps };
}

/* ─────────────────────────── le rendu ───────────────────────────────────── */

function rendreEnfants(enfants: Noeud[] | undefined): string {
  return (enfants ?? [])
    .map((n) => {
      const c = COMPOSANTS[n.type];
      /* Bruyant, jamais muet : le test refuse cette sortie en CI. */
      if (!c) {
        return `<p class="inconnu">composant non pris en charge : <code>${ech(n.type)}</code></p>`;
      }
      return c.rendre(n, rendreEnfants);
    })
    .join("");
}

/** Un Flow : sa fiche, puis ses ecrans cote a cote. */
export function rendreFlux(cle: string, spec: SpecFlux): string {
  const m = mesurer(spec);

  /**
   * TOUS les ecrans, cote a cote, jamais un seul avec les autres derriere un
   * clic. Une premiere version les masquait et les faisait defiler au bouton :
   * plus fidele au telephone, mais un ecran cache est un ecran qu'on ne relit
   * pas dans un diff — et c'est pour etre relu que cette page existe. Retirer
   * ce pilotage a retire tout le JavaScript de la page.
   */
  const total = spec.screens.length;
  const ecrans = spec.screens
    .map(
      (e, i) => `
      <section class="ecran" id="${ech(cle)}-${ech(e.id)}">
        <header class="barre">
          <span class="fermer" aria-hidden="true">✕</span>
          <h3>${ech(e.title)}</h3>
        </header>
        <div class="feuille">
          ${rendreEnfants([e.layout])}
        </div>
        <p class="etiquette-ecran">
          ${total > 1 ? `écran ${i + 1} / ${total} · ` : ""}<code>${ech(e.id)}</code>${
            e.terminal === true ? " · terminal" : ""
          }
        </p>
      </section>`,
    )
    .join("");

  return `
  <article class="flux" data-cle="${ech(cle)}">
    <div class="fiche">
      <h2>${ech(cle)}</h2>
      <p class="legende">${ech(LEGENDES[cle] ?? "")}</p>
      <dl>
        <div><dt>version</dt><dd>${ech(spec.version)}</dd></div>
        <div><dt>écrans</dt><dd>${total}</dd></div>
        <div><dt>obligatoires</dt><dd>${m.obligatoires}</dd></div>
        <div><dt>facultatifs</dt><dd>${m.facultatifs}</dd></div>
        <div><dt>gestes minimum</dt><dd><strong>${m.gestes}</strong></dd></div>
      </dl>
      <p class="source">docs/flux-${ech(cle)}.json</p>
    </div>
    <div class="ecrans">${ecrans}</div>
  </article>`;
}

/* ─────────────────────────── la page ───────────────────────────────────── */

const STYLE = `
:root { --fond:#111b21; --carte:#ffffff; --encre:#111b21; --gris:#667781;
  --trait:#e9edef; --vert:#008069; --rouge:#c4314b }
* { box-sizing:border-box }
body { margin:0; padding:24px; background:var(--fond); color:#e9edef;
  font:400 15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif }
h1 { font-size:20px; margin:0 0 4px }
.avant-propos { max-width:70ch; color:#aebac1; font-size:14px }
.avant-propos strong { color:#e9edef }
.avant-propos table { border-collapse:collapse; margin:12px 0; font-size:13px }
.avant-propos td { border:1px solid #2a3942; padding:6px 10px; vertical-align:top }
.flux { display:grid; grid-template-columns:minmax(0,22ch) 1fr; gap:20px;
  align-items:start; margin:28px 0; padding-top:20px; border-top:1px solid #2a3942 }
.fiche h2 { font-size:16px; margin:0 0 6px; color:#e9edef }
.legende { color:#8696a0; font-size:13px; margin:0 0 10px }
.fiche dl { margin:0; font-size:13px }
.fiche dl div { display:flex; justify-content:space-between; gap:8px; padding:2px 0 }
.fiche dt { color:#8696a0 } .fiche dd { margin:0 }
.source { font:12px/1.4 ui-monospace,monospace; color:#667781; margin:10px 0 0 }
.ecrans { display:flex; flex-wrap:wrap; gap:16px }
.ecran { width:320px; background:var(--carte); color:var(--encre);
  border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.4) }
.barre { display:flex; align-items:center; gap:12px; padding:12px 14px;
  border-bottom:1px solid var(--trait) }
.barre h3 { font-size:15px; font-weight:500; margin:0 }
.fermer { color:var(--gris) }
.feuille { padding:14px }
.sous-titre { font-size:15px; font-weight:500; margin:0 0 12px }
.corps { font-size:14px; color:var(--gris); margin:10px 0 }
.champ { display:block; margin:0 0 16px; border:0; padding:0 }
.etiquette { display:block; font-size:12px; color:var(--gris); margin-bottom:2px }
.obligatoire { color:var(--vert); font-size:16px; line-height:0 }
.saisie { display:block; height:22px; border-bottom:1.5px solid var(--vert) }
.saisie.longue { height:52px; border:1.5px solid var(--vert); border-radius:6px }
.saisie::after { content:attr(data-clavier); font-size:11px; color:#c9d1d3;
  float:right; line-height:22px }
.aide { display:block; font-size:11px; color:var(--gris); margin-top:4px }
.groupe .option { display:flex; align-items:center; gap:8px; font-size:14px; padding:5px 0 }
.rond { width:16px; height:16px; border:1.5px solid var(--gris); border-radius:50%; flex:none }
.optin { display:flex; align-items:center; gap:8px; font-size:14px }
.case { width:16px; height:16px; border:1.5px solid var(--gris); border-radius:3px; flex:none }
.depot { display:flex; align-items:center; gap:10px; padding:12px;
  border:1.5px dashed var(--trait); border-radius:8px; font-size:12px; color:var(--gris) }
.appareil { font-size:20px }
.pied { margin-top:18px }
.bouton { display:flex; align-items:center; justify-content:center; min-height:44px;
  border-radius:22px; background:var(--vert); color:#fff; font-weight:500 }
.mention { text-align:center; font-size:11px; color:#c9d1d3; margin:8px 0 0 }
.contrat { margin-top:10px; font-size:12px; color:var(--gris) }
.contrat summary { cursor:pointer }
.contrat ul { margin:6px 0 0; padding-left:18px }
.contrat code { font-family:ui-monospace,monospace }
.etiquette-ecran { margin:0; padding:8px 14px; border-top:1px solid var(--trait);
  font:12px ui-monospace,monospace; color:var(--gris) }
.inconnu { background:var(--rouge); color:#fff; padding:8px; border-radius:6px; font-size:13px }
`;

export function construirePage(flux: Flux[]): string {
  const total = flux.reduce((n, f) => n + mesurer(f.spec).gestes, 0);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aperçu des Flows — Catalog</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Aperçu des Flows</h1>
<div class="avant-propos">
<p><strong>Cette page est générée</strong> par <code>apps/api/scripts/apercu-flux.ts</code>,
qui ne lit rien d'autre que <code>docs/flux-*.json</code>. Elle ne s'édite pas à la main :
un test la régénère et refuse toute différence.</p>
<table>
<tr><td><strong>Mesuré</strong> — vient du JSON</td>
<td>titres, textes, libellés, textes d'aide, ordre, obligation, options,
libellé du bouton, enchaînement des écrans, charge utile renvoyée</td></tr>
<tr><td><strong>Dessiné</strong> — approximation</td>
<td>barre de titre, couleurs, espacements, forme des champs, mention de bas de page.
WhatsApp reste seul juge du pixel.</td></tr>
</table>
<p>L'aperçu <em>officiel</em> (<code>POST /{flow-id}/preview</code>) rend le vrai rendu,
mais exige l'administration du WABA — gelée depuis le 16/08/2026, ADR 0109.</p>
<p>Le point vert <span class="obligatoire">•</span> marque un champ obligatoire.
« Gestes minimum » compte les champs obligatoires plus une pression sur le bouton :
<strong>${total} gestes</strong> pour les ${flux.length} Flows réunis.</p>
</div>
${flux.map((f) => rendreFlux(f.cle, f.spec)).join("")}
</body>
</html>
`;
}

/* ─────────────────────────── lecture du dossier ─────────────────────────── */

/**
 * Les definitions, dans l'ordre du parcours, les inconnues a la fin.
 *
 * Le `as SpecFlux` est la frontiere assumee : un JSON hors forme ne serait pas
 * attrape ici mais par les tests, qui exigent des ecrans, des pieds et des
 * composants connus. Un schema Zod de plus pour six fichiers versionnes que la
 * CI relit a chaque execution serait du poids sans garantie de plus.
 */
export function lireFlux(racine: string = RACINE): Flux[] {
  const dossier = join(racine, "docs");
  const cles = readdirSync(dossier)
    .filter((f) => /^flux-.+\.json$/.test(f))
    .map((f) => f.slice("flux-".length, -".json".length));
  const rang = (c: string): number => (ORDRE.includes(c) ? ORDRE.indexOf(c) : ORDRE.length);
  cles.sort((a, b) => rang(a) - rang(b) || a.localeCompare(b));
  return cles.map((cle) => ({
    cle,
    spec: JSON.parse(readFileSync(join(dossier, `flux-${cle}.json`), "utf8")) as SpecFlux,
  }));
}

/* ─────────────────────────── la commande ────────────────────────────────── */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flux = lireFlux();
  const page = construirePage(flux);

  const iSortie = args.indexOf("--sortie");
  const sortie = iSortie >= 0 ? resolve(args[iSortie + 1] ?? "") : SORTIE_PAR_DEFAUT;

  if (args.includes("--verifier")) {
    if (readFileSync(sortie, "utf8") === page) {
      console.log(`à jour : ${sortie}`);
    } else {
      console.error(`PÉRIMÉ : ${sortie}\nrelancer : node apps/api/scripts/apercu-flux.ts`);
      process.exit(1);
    }
  } else {
    writeFileSync(sortie, page, "utf8");
    console.log(`${flux.length} Flows dessinés → ${sortie}`);
    for (const f of flux) {
      const m = mesurer(f.spec);
      console.log(
        `  ${f.cle.padEnd(12)} ${f.spec.screens.length} écran(s)  ` +
          `${m.obligatoires} obligatoire(s)  ${m.facultatifs} facultatif(s)  ` +
          `${m.gestes} geste(s)`,
      );
    }
  }
}
