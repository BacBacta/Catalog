/**
 * Les gabarits a deposer chez Meta — ADR 0054.
 *
 *   node apps/api/scripts/gabarits.mjs            → les affiche
 *   node apps/api/scripts/gabarits.mjs --etat     → dit lesquels existent deja
 *   node apps/api/scripts/gabarits.mjs --deposer  → les soumet a l'approbation
 *
 * Les corps sont LUS du catalogue (`domain/bot/gabarits.ts`), jamais recopies :
 * un gabarit approuve dont le texte differerait du code enverrait un message
 * que personne n'a relu.
 *
 * ── Le transport est META, plus 360dialog ─────────────────────────────────
 *
 * Ce script parlait les chemins de l'ancienne passerelle (`/v1/configs/
 * templates`, en-tete `D360-API-KEY`). Depuis la bascule en direct chez Meta
 * (ADR 0046), ces chemins n'existent plus : mesure le 12/08/2026, run
 * 31641872880 — douze refus « Unknown path components », ZERO depot, et le
 * job vert quand meme. Deux lecons, toutes deux tenues ici :
 *
 * 1. le transport est celui de `flux.mjs` — Graph Meta, jeton en Bearer,
 *    WABA decouvert par le jeton quand `WHATSAPP_WABA_ID` n'est pas posee ;
 * 2. un echec ne se deguise plus : `--etat` REFUSE de repondre si la liste
 *    ne se lit pas (avant, il affichait ABSENT partout), et `--deposer`
 *    sort en erreur des qu'un gabarit est refuse.
 *
 * `--deposer` est un acte SORTANT et durable : Meta examine, et une serie de
 * refus abime la note de qualite du numero. Il ne part jamais tout seul.
 */
import { GABARITS } from "../src/domain/bot/gabarits.ts";

const JETON = process.env.WABOT_API_KEY?.trim();
let WABA = process.env.WHATSAPP_WABA_ID?.trim();
const BASE = (process.env.WABOT_GRAPH_URL ?? "https://graph.facebook.com/v26.0").replace(/\/$/, "");
const mode = process.argv[2] ?? "--voir";

/**
 * La forme attendue par Meta, une entree par langue.
 *
 * `example` est OBLIGATOIRE des qu'il y a une variable : Meta ne peut pas
 * juger « {{1}} », et refuse avec `INVALID_FORMAT` sans un mot de plus.
 * Mesure le 08/08/2026 — dix refus d'un coup, puis deux essais temoins.
 */
function composants(g) {
  return Object.entries(g.corps).map(([langue, texte]) => ({
    name: g.nom,
    category: g.categorie.toUpperCase(),
    language: langue,
    components: [
      {
        type: "BODY",
        text: texte,
        ...(g.exemples.length > 0 ? { example: { body_text: [g.exemples] } } : {}),
      },
    ],
  }));
}

const tous = Object.values(GABARITS).flatMap(composants);

if (mode === "--voir") {
  for (const t of tous) {
    console.log(`\n── ${t.name} · ${t.language} · ${t.category} ──`);
    console.log(t.components[0].text);
  }
  console.log(`\n${tous.length} gabarits (${Object.keys(GABARITS).length} sujets × 2 langues).`);
  console.log("Pour les deposer : node apps/api/scripts/gabarits.mjs --deposer");
  process.exit(0);
}

if (!JETON) {
  console.error("WABOT_API_KEY absent — impossible de parler a Meta.");
  process.exit(1);
}

async function appel(chemin, options = {}) {
  const r = await fetch(chemin.startsWith("https://") ? chemin : `${BASE}${chemin}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${JETON}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const corps = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, corps };
}

/* `WHATSAPP_WABA_ID` absente : on la demande au jeton, comme `flux.mjs` —
   c'est lui qui porte le diagnostic detaille quand le jeton ne designe pas
   exactement un compte. La regle est la meme ici : un seul WABA, sinon arret
   franc — deposer sur le mauvais compte serait pire qu'echouer. */
if (!WABA) {
  const { corps } = await appel(`/debug_token?input_token=${encodeURIComponent(JETON)}`);
  const portees = corps?.data?.granular_scopes ?? [];
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
      `WHATSAPP_WABA_ID est absente, et le jeton designe ${cibles.size} compte(s) — ` +
        "il en faut exactement un. Diagnostic detaille : node apps/api/scripts/flux.mjs --etat",
    );
    process.exit(1);
  }
  WABA = [...cibles][0];
}

/* La liste du WABA, TOUTES pages suivies : la pagination de Meta rend des
   URL absolues dans `paging.next`. */
const deja = new Map();
let page = `/${WABA}/message_templates?fields=name,language,status&limit=200`;
while (page) {
  const { ok, status, corps } = await appel(page);
  if (!ok) {
    /* Refuser de repondre vaut mieux que mentir : l'ancienne version avalait
       cet echec et affichait ABSENT partout — voir l'en-tete. */
    console.error(
      `La liste des gabarits ne se lit pas : HTTP ${status} ${JSON.stringify(corps?.error?.message ?? corps).slice(0, 240)}`,
    );
    process.exit(1);
  }
  for (const t of corps?.data ?? []) {
    deja.set(`${t.name}:${t.language}`, (t.status ?? "").toUpperCase());
  }
  page = corps?.paging?.next ?? null;
}

if (mode === "--etat") {
  for (const t of tous) {
    const s = deja.get(`${t.name}:${t.language}`);
    console.log(`${s ? s.padEnd(10) : "ABSENT".padEnd(10)} ${t.name} · ${t.language}`);
  }
  process.exit(0);
}

if (mode === "--nettoyer") {
  /* Un gabarit REFUSE occupe son nom : on ne peut pas en redeposer un du
     meme nom sans retirer l'ancien. Les essais techniques partent aussi.
     L'effacement se fait par NOM — un nom couvre toutes ses langues. */
  const noms = [
    ...new Set(
      [...deja.entries()]
        .filter(([cle, statut]) => statut === "REJECTED" || cle.startsWith("catalog_essai"))
        .map(([cle]) => cle.split(":")[0]),
    ),
  ];
  let retires = 0;
  for (const nom of noms) {
    const { ok, status } = await appel(
      `/${WABA}/message_templates?name=${encodeURIComponent(nom)}`,
      { method: "DELETE" },
    );
    console.log(`${ok ? "🗑️  retire" : `❌ HTTP ${status}`} : ${nom}`);
    if (ok) retires += 1;
  }
  console.log(`\n${retires} gabarit(s) retire(s).`);
  process.exit(0);
}

if (mode !== "--deposer") {
  console.error(`mode inconnu : ${mode}`);
  process.exit(1);
}

let poses = 0;
let refus = 0;
for (const t of tous) {
  const cle = `${t.name}:${t.language}`;
  if (deja.has(cle)) {
    console.log(`· deja la (${deja.get(cle)}) : ${cle}`);
    continue;
  }
  const { ok, status, corps } = await appel(`/${WABA}/message_templates`, {
    method: "POST",
    body: JSON.stringify(t),
  });
  if (ok) {
    poses += 1;
    console.log(`✅ depose : ${cle}`);
  } else {
    /* Le corps de refus de Meta nomme la regle enfreinte — il est utile, et
       il ne porte aucun contenu de conversation. */
    refus += 1;
    console.log(`❌ refuse : ${cle} → HTTP ${status} ${JSON.stringify(corps).slice(0, 240)}`);
  }
}
console.log(`\n${poses} gabarit(s) déposé(s). L'examen de Meta prend de quelques minutes à 24 h.`);
console.log("Suivre : node apps/api/scripts/gabarits.mjs --etat");
if (refus > 0) {
  /* Un depot qui n'a rien depose n'est pas un succes — le job de CI qui
     enveloppe ce script doit rougir, pas verdir (mesure du 12/08). */
  process.exit(1);
}
