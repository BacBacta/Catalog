import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Catalog n'a AUCUN champ ou un code secret mobile money pourrait etre saisi.**
 *
 * C'est un interdit absolu du lot 9, et il ne se verifie pas a la relecture : un
 * champ « PIN » ajoute de bonne foi, six mois plus tard, sur un ecran de
 * paiement, ressemblerait a une amelioration. Ce test parcourt les deux
 * interfaces et echoue s'il en trouve un.
 *
 * ── Ce qui est cherche, et ce qui ne l'est pas ────────────────────────────
 *
 * Le motif de la definition de terminé est ancre sur des mots entiers exprès :
 * « spinner » et « mapping » ne doivent pas le declencher. On va plus loin, et
 * c'est necessaire : il est applique aux **contextes qui creent un champ ou une
 * cle d'etat** — elements de saisie, attributs de champ, identifiants declares,
 * cles d'objet — et **pas a la prose**.
 *
 * La distinction n'est pas un assouplissement, c'est le sens de la regle.
 * L'ecran de paiement DOIT ecrire « votre code secret ne se tape jamais sur
 * Catalog » : c'est l'avertissement qui protege l'acheteuse de l'hameconnage.
 * Un test qui interdirait la phrase interdirait l'avertissement et laisserait
 * passer un `<input name="pin">` derriere un libelle innocent — exactement
 * l'inverse de ce qu'on veut.
 *
 * Ce test vit avec les autres gardes du depot (`aggregator-dormant`,
 * `node-strip-only`, `domaine-pur`) : c'est la seule suite qui parcourt l'arbre.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Le motif de la definition de terminé, mot par mot. */
const SECRET = /\b(pin|code[_ -]?secret|secret[_ -]?code|mot de passe momo)\b/i;

/** Les arbres d'interface. La documentation est exclue : elle DOIT en parler. */
const ARBRES = ["apps/shop/src", "apps/seller/src", "apps/seller/e2e", "packages/ui/src"];

/**
 * Les fichiers de test sont hors du parcours, et c'est un choix, pas un oubli :
 * ils AFFIRMENT l'absence — `expect(html).not.toMatch(/<input/)` —, donc ils
 * contiennent les motifs cherches par construction. Un champ reel, lui, ne peut
 * pas exister uniquement dans un test : il faudrait qu'il soit rendu quelque
 * part, et ce quelque part est parcouru.
 */
const EST_TEST = /(^|[./])(__tests__|e2e)[/]|\.(test|spec)\.[jt]sx?$/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) return [];
    const chemin = join(dir, e.name);
    if (e.isDirectory()) return sources(chemin);
    if (!/\.(ts|tsx|astro|jsx|js|mjs)$/.test(e.name)) return [];
    return EST_TEST.test(chemin) ? [] : [chemin];
  });
}

/** Attributs qui fabriquent un champ, une etiquette ou une cle. */
const ATTRIBUTS = [
  "name",
  "id",
  "for",
  "placeholder",
  "label",
  "aria-label",
  "autocomplete",
  "data-testid",
  "inputmode",
];

/**
 * Les endroits d'un fichier ou le motif compte : elements de saisie, attributs
 * de champ, identifiants declares, cles d'objet. La prose et les commentaires
 * n'y sont pas.
 */
function contextesDeSaisie(source: string): string[] {
  const trouves: string[] = [];

  // 1. tout element de saisie, en entier — attributs compris.
  for (const m of source.matchAll(/<(input|textarea|select)\b[^>]*>/gi)) {
    trouves.push(m[0]);
  }

  // 2. les attributs qui nomment un champ ou l'etiquettent.
  for (const m of source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g)) {
    const nom = (m[1] ?? "").toLowerCase();
    if (ATTRIBUTS.includes(nom)) trouves.push(`${nom}=${m[2] ?? m[3] ?? m[4] ?? ""}`);
  }

  // 3. les identifiants declares — variables d'etat, fonctions, types.
  for (const m of source.matchAll(
    /\b(?:const|let|var|function|interface|type|class|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    trouves.push(m[1] ?? "");
  }

  // 4. les cles d'objet et les noms destructures.
  for (const m of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*:/g)) trouves.push(m[1] ?? "");
  for (const m of source.matchAll(/[{[,]\s*([A-Za-z_$][\w$]*)/g)) trouves.push(m[1] ?? "");

  return trouves;
}

describe("aucun champ de code secret dans les interfaces", () => {
  const fichiers = ARBRES.flatMap((a) => sources(join(RACINE, a)));

  it("parcourt bien les deux applications", () => {
    expect(fichiers.length).toBeGreaterThan(20);
    expect(fichiers.some((f) => EST_TEST.test(f))).toBe(false);
    expect(fichiers.some((f) => f.includes("/shop/"))).toBe(true);
    expect(fichiers.some((f) => f.includes("/seller/"))).toBe(true);
  });

  it("ne trouve ni champ, ni cle d'etat, ni libelle de code secret", () => {
    const coupables: string[] = [];
    for (const f of fichiers) {
      for (const contexte of contextesDeSaisie(readFileSync(f, "utf8"))) {
        if (SECRET.test(contexte)) {
          coupables.push(`${relative(RACINE, f)} → ${contexte.slice(0, 80)}`);
        }
      }
    }
    expect(coupables).toEqual([]);
  });

  it("laisse passer l'AVERTISSEMENT, qui doit exister", () => {
    // « Votre code secret ne se tape jamais sur Catalog » protege l'acheteuse de
    // l'hameconnage. L'interdire serait interdire la bonne pratique.
    const rampe = readFileSync(join(RACINE, "apps/shop/src/islands/rampe/Rampe.tsx"), "utf8");
    expect(rampe).toMatch(/code secret/i);
    expect(contextesDeSaisie(rampe).filter((c) => SECRET.test(c))).toEqual([]);
  });
});

/**
 * Un test de garde qui ne detecte rien est pire qu'absent : il rassure.
 */
describe("la garde detecte vraiment", () => {
  const attrape = (src: string) => contextesDeSaisie(src).some((c) => SECRET.test(c));

  it("attrape un champ de saisie", () => {
    expect(attrape('<input name="pin" type="password" />')).toBe(true);
    expect(attrape('<input id="code-secret" />')).toBe(true);
    expect(attrape('<textarea placeholder="Votre code secret" />')).toBe(true);
    expect(attrape('<input aria-label="Secret code" />')).toBe(true);
  });

  it("attrape une cle d'etat", () => {
    expect(attrape("const [pin, setPin] = useState('');")).toBe(true);
    expect(attrape("const codeSecret = lireLeChamp();")).toBe(true);
    expect(attrape("const corps = { montant, secret_code: valeur };")).toBe(true);
  });

  it("attrape un libelle de champ", () => {
    expect(attrape('<label for="pin">Entrez votre code</label>')).toBe(true);
  });

  it("ne se declenche PAS sur les mots qui contiennent le motif", () => {
    // Le motif est ancre sur des mots entiers exprès.
    expect(attrape("const spinner = 1; const mapping = 2; const pinceau = 3;")).toBe(false);
    expect(attrape('<div class="spinner" data-testid="mapping-1" />')).toBe(false);
  });

  it("ne se declenche PAS sur la prose ni sur un commentaire", () => {
    expect(attrape("// le code secret se saisit chez l'operateur")).toBe(false);
    expect(attrape("<p>Votre code secret ne se tape jamais sur Catalog.</p>")).toBe(false);
  });
});
