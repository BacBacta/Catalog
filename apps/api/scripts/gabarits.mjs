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
 * `--deposer` est un acte SORTANT et durable : Meta examine, et une serie de
 * refus abime la note de qualite du numero. Il ne part jamais tout seul.
 */
import { GABARITS } from "../src/domain/bot/gabarits.ts";

const CLE = process.env.WABOT_API_KEY?.trim();
const BASE = (process.env.WABOT_BASE_URL ?? "https://waba-v2.360dialog.io").replace(/\/$/, "");
const mode = process.argv[2] ?? "--voir";

/** La forme attendue par 360dialog, une entree par langue. */
function composants(g) {
  return Object.entries(g.corps).map(([langue, texte]) => ({
    name: g.nom,
    category: g.categorie.toUpperCase(),
    language: langue,
    components: [{ type: "BODY", text: texte }],
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

if (!CLE) {
  console.error("WABOT_API_KEY absent — impossible de parler a 360dialog.");
  process.exit(1);
}

const enLigne = await fetch(`${BASE}/v1/configs/templates`, {
  headers: { "D360-API-KEY": CLE },
}).then((r) => r.json());
const deja = new Map(
  (enLigne.waba_templates ?? []).map((t) => [`${t.name}:${t.language}`, t.status]),
);

if (mode === "--etat") {
  for (const t of tous) {
    const s = deja.get(`${t.name}:${t.language}`);
    console.log(`${s ? s.padEnd(10) : "ABSENT".padEnd(10)} ${t.name} · ${t.language}`);
  }
  process.exit(0);
}

if (mode !== "--deposer") {
  console.error(`mode inconnu : ${mode}`);
  process.exit(1);
}

let poses = 0;
for (const t of tous) {
  const cle = `${t.name}:${t.language}`;
  if (deja.has(cle)) {
    console.log(`· deja la (${deja.get(cle)}) : ${cle}`);
    continue;
  }
  const r = await fetch(`${BASE}/v1/configs/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "D360-API-KEY": CLE },
    body: JSON.stringify(t),
  });
  const corps = await r.text();
  if (r.ok) {
    poses += 1;
    console.log(`✅ depose : ${cle}`);
  } else {
    /* Le corps de refus de Meta nomme la regle enfreinte — il est utile, et
       il ne porte aucun contenu de conversation. */
    console.log(`❌ refuse : ${cle} → HTTP ${r.status} ${corps.slice(0, 240)}`);
  }
}
console.log(`\n${poses} gabarit(s) déposé(s). L'examen de Meta prend de quelques minutes à 24 h.`);
console.log("Suivre : node apps/api/scripts/gabarits.mjs --etat");
