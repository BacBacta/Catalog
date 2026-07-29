import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Le contraste n'est pas une intention, c'est une mesure.
 *
 * Ce test lit `tokens.css`, en extrait les valeurs des deux themes, et calcule
 * les ratios WCAG 2.2. Il echoue en CI si une retouche de couleur casse une
 * paire. C'est ce qui distingue « mode sombre concu » de « mode sombre
 * obtenu par inversion » : chaque valeur sombre est verifiee pour SA surface,
 * pas deduite de la valeur claire.
 *
 * Seuils appliques :
 *   4,5:1  texte normal (1.4.3) — la legende a 0,78rem en fait partie
 *   3,0:1  composants d'interface et bords porteurs d'information (1.4.11)
 */

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "tokens.css"), "utf8");

/** Les jetons du bloc @theme = mode clair. */
function lightTokens(): Record<string, string> {
  const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(CSS);
  if (!block?.[1]) throw new Error("bloc @theme introuvable dans tokens.css");
  return parseVars(block[1]);
}

/** Le bloc [data-theme="dark"] surcharge le clair : on fusionne. */
function darkTokens(): Record<string, string> {
  const block = /:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/.exec(CSS);
  if (!block?.[1]) throw new Error("bloc data-theme=dark introuvable dans tokens.css");
  return { ...lightTokens(), ...parseVars(block[1]) };
}

function parseVars(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const k = m[1];
    const v = m[2];
    if (k && v) out[k] = v.trim();
  }
  return out;
}

function channels(hex: string): [number, number, number] {
  const h = hex.trim();
  if (!/^#[0-9a-f]{6}$/i.test(h)) throw new Error(`couleur non hexadecimale: ${hex}`);
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Paires a tenir. `min` suit le critere applicable, pas une preference. */
const PAIRES: Array<{ fg: string; bg: string; min: number; quoi: string }> = [
  { fg: "--color-ink", bg: "--color-surface", min: 4.5, quoi: "texte principal sur carte" },
  { fg: "--color-ink", bg: "--color-plane", min: 4.5, quoi: "texte principal sur fond" },
  { fg: "--color-ink", bg: "--color-raised", min: 4.5, quoi: "texte en boite de dialogue" },
  { fg: "--color-ink-2", bg: "--color-surface", min: 4.5, quoi: "texte secondaire" },
  { fg: "--color-ink-2", bg: "--color-plane", min: 4.5, quoi: "texte secondaire sur fond" },
  { fg: "--color-muted", bg: "--color-surface", min: 4.5, quoi: "legende" },
  { fg: "--color-muted", bg: "--color-plane", min: 4.5, quoi: "legende sur fond" },
  { fg: "--color-brand-500", bg: "--color-surface", min: 4.5, quoi: "lien / accent" },
  { fg: "--color-good", bg: "--color-surface", min: 4.5, quoi: "statut bon" },
  { fg: "--color-warn", bg: "--color-surface", min: 4.5, quoi: "statut avertissement" },
  { fg: "--color-danger", bg: "--color-surface", min: 4.5, quoi: "statut danger" },
  // Pastilles : le texte de statut sur son fond teinte.
  { fg: "--color-good", bg: "--color-good-soft", min: 4.5, quoi: "pastille bon" },
  { fg: "--color-warn", bg: "--color-warn-soft", min: 4.5, quoi: "pastille avertissement" },
  { fg: "--color-danger", bg: "--color-danger-soft", min: 4.5, quoi: "pastille danger" },
  { fg: "--color-brand-500", bg: "--color-brand-soft", min: 4.5, quoi: "pastille marque" },
  // Bouton plein : l'encre DOIT aller avec son fond.
  { fg: "--color-brand-on-fill", bg: "--color-brand-fill", min: 4.5, quoi: "libelle de bouton" },
  // Bords porteurs d'information et anneau de focus : 3:1 suffit.
  { fg: "--color-control-line", bg: "--color-surface", min: 3, quoi: "bord de champ" },
  { fg: "--color-focus", bg: "--color-surface", min: 3, quoi: "anneau de focus" },
];

describe.each([
  ["clair", lightTokens()],
  ["sombre", darkTokens()],
])("contraste WCAG 2.2 AA — theme %s", (_theme, tokens) => {
  it.each(PAIRES)("$quoi : $fg sur $bg ≥ $min:1", ({ fg, bg, min }) => {
    const cfg = tokens[fg];
    const cbg = tokens[bg];
    expect(cfg, `jeton absent: ${fg}`).toBeDefined();
    expect(cbg, `jeton absent: ${bg}`).toBeDefined();
    const r = contrast(cfg as string, cbg as string);
    expect(
      Number(r.toFixed(2)),
      `${fg} (${cfg}) sur ${bg} (${cbg}) = ${r.toFixed(2)}:1, il faut ${min}:1`,
    ).toBeGreaterThanOrEqual(min);
  });
});

describe("le mode sombre est concu, pas inverse", () => {
  const light = lightTokens();
  const dark = darkTokens();

  it("surcharge explicitement chaque surface et chaque encre", () => {
    for (const k of [
      "--color-surface",
      "--color-plane",
      "--color-raised",
      "--color-ink",
      "--color-ink-2",
      "--color-muted",
      "--color-line",
      "--color-control-line",
    ]) {
      expect(dark[k], `${k} n'est pas redefini en sombre`).not.toBe(light[k]);
    }
  });

  it("la preference explicite l'emporte dans les DEUX sens", () => {
    // data-theme="light" doit survivre a prefers-color-scheme: dark, sinon un
    // utilisateur qui choisit le clair sur un telephone en sombre est ignore.
    expect(CSS).toMatch(/:root:where\(:not\(\[data-theme="light"\]\)\)/);
    expect(CSS).toMatch(/:root\[data-theme="dark"\]/);
  });

  it("l'encre du bouton plein change avec le fond de marque", () => {
    expect(dark["--color-brand-on-fill"]).not.toBe(light["--color-brand-on-fill"]);
  });
});

describe("contraintes non negociables du socle", () => {
  it("aucune police telechargee : ni @font-face, ni import distant", () => {
    expect(CSS).not.toMatch(/@font-face/);
    expect(CSS).not.toMatch(/fonts\.googleapis|fontsource|\.woff2?/);
  });

  it("la cible tactile est de 44px, au-dela des 24px de WCAG 2.2", () => {
    expect(CSS).toMatch(/--size-touch:\s*44px/);
  });

  it("prefers-reduced-motion est respecte", () => {
    expect(CSS).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("les champs de saisie comptent comme cibles tactiles", () => {
    const base = /@layer base\s*\{([\s\S]*)\}/.exec(CSS)?.[1] ?? "";
    expect(base).toMatch(/textarea/);
    expect(base).toMatch(/min-block-size:\s*var\(--size-touch\)/);
  });

  it("le focus visible n'est jamais supprime", () => {
    expect(CSS).toMatch(/:focus-visible\s*\{[\s\S]*?outline:/);
    expect(CSS).not.toMatch(/outline:\s*(none|0)/);
  });
});
