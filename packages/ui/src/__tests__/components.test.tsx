import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState, ErrorState, LoadingState, OfflineState, StatusBadge } from "../blocks.tsx";
import { MoneyDisplay } from "../money-display.tsx";
import { type ProofCheckItem, ProofChecklist } from "../proof-checklist.tsx";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

/**
 * Lit la source SANS ses commentaires. Les blocs de documentation de ce paquet
 * citent volontairement les motifs interdits pour expliquer pourquoi ils le
 * sont ; un test qui les compte se declencherait sur sa propre explication.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ═════════════════ le collage n'est jamais bloque ═════════════════ */

/**
 * AGENTS.md range « bloquer le collage dans un champ OTP ou dans le champ de
 * SMS operateur » parmi les interdits, et WCAG 2.2 §3.3.8 dit pourquoi. Un test
 * de rendu ne le prouverait pas : un `onPaste` qui appelle `preventDefault` est
 * invisible dans le balisage. On lit donc la source.
 */
describe("le collage n'est jamais bloque", () => {
  const FICHIERS = [
    "sms-paste-field.tsx",
    "otp-field.tsx",
    "primitives/basics.tsx",
    "primitives/overlays.tsx",
    "blocks.tsx",
  ];

  it("aucun composant n'intercepte onPaste, onCopy ni onContextMenu", () => {
    const coupables = FICHIERS.filter((f) => /on(Paste|Copy|Cut|ContextMenu)\s*=/.test(code(f)));
    expect(coupables, `interception d'evenement de collage dans : ${coupables.join(", ")}`).toEqual(
      [],
    );
  });

  it("le champ de SMS n'appelle preventDefault nulle part", () => {
    expect(code("sms-paste-field.tsx")).not.toMatch(/preventDefault/);
  });

  it("le champ de SMS reste un vrai textarea, editable et redimensionnable", () => {
    const src = code("sms-paste-field.tsx");
    expect(src).toMatch(/<textarea/);
    expect(src).not.toMatch(/readOnly/);
    expect(src).toMatch(/resize-y/);
  });

  it("il propose un bouton « coller » explicite qui lit le presse-papiers", () => {
    const src = code("sms-paste-field.tsx");
    expect(src).toMatch(/clipboard\?\.readText\(\)/);
    expect(src).toMatch(/Coller/);
  });

  /**
   * Le champ OTP porte la meme regle, en plus fort : c'est celui que le critere
   * 3.3.8 nomme. Trois attributs y sont fonctionnels, pas decoratifs, et leur
   * absence ne casserait aucun rendu — d'ou un test qui les nomme.
   */
  it("le champ OTP n'appelle preventDefault nulle part", () => {
    expect(code("otp-field.tsx")).not.toMatch(/preventDefault/);
  });

  it("le champ OTP declare one-time-code, un pave numerique, et reste type=text", () => {
    const src = code("otp-field.tsx");
    expect(src).toMatch(/autoComplete="one-time-code"/);
    expect(src).toMatch(/inputMode="numeric"/);
    // `type="number"` supprimerait un zero de tete : un code « 048190 » y perd
    // son premier chiffre.
    expect(src).toMatch(/type="text"/);
    expect(src).not.toMatch(/type="number"/);
  });

  it("le champ OTP est UN champ, pas six cases", () => {
    // Six cases cassent l'auto-remplissage et le collage. Un seul <input>.
    const src = code("otp-field.tsx");
    expect(src.match(/<input/g)?.length ?? 0).toBe(1);
    expect(src).not.toMatch(/readOnly/);
  });

  it("le champ OTP garde les chiffres d'un message colle en entier", () => {
    // Le nettoyage retire les non-chiffres au lieu de refuser la saisie : c'est
    // ce qui permet de coller « votre code est 481902. » sans decouper.
    expect(code("otp-field.tsx")).toMatch(/replace\(\/\\D\/g, ""\)/);
  });

  it("un refus du presse-papiers laisse le champ utilisable", () => {
    // Le catch ne doit pas desactiver le champ : il explique et rend le focus.
    const src = code("sms-paste-field.tsx");
    const catchBlock = /catch\s*\{([\s\S]*?)\n {4}\}/.exec(src)?.[1] ?? "";
    expect(catchBlock).toMatch(/setClipboardNote/);
    expect(catchBlock).not.toMatch(/disabled\s*=|setDisabled/);
  });
});

/* ═════════════════ MoneyDisplay ═════════════════ */

describe("MoneyDisplay", () => {
  /** Espace fine insecable — celle que `formatXaf` insere. */
  const NBSP = " ";

  it("groupe les milliers avec une espace INSECABLE", () => {
    const html = renderToStaticMarkup(<MoneyDisplay amountXaf={15000} />);
    expect(html).toContain(`15${NBSP}000${NBSP}FCFA`);
    expect(html).not.toContain("15 000"); // espace ordinaire : coupable en fin de ligne
  });

  it("sait retirer l'unite quand l'en-tete la porte deja", () => {
    expect(renderToStaticMarkup(<MoneyDisplay amountXaf={7501} suffix={false} />)).not.toContain(
      "FCFA",
    );
  });

  it("chiffres tabulaires en colonne, proportionnels en grand", () => {
    expect(renderToStaticMarkup(<MoneyDisplay amountXaf={1} tabular />)).toContain("tabular-nums");
    expect(renderToStaticMarkup(<MoneyDisplay amountXaf={1} size="hero" />)).toContain(
      "proportional-nums",
    );
  });

  it("REFUSE un montant non entier plutot que d'afficher un arrondi", () => {
    expect(() => renderToStaticMarkup(<MoneyDisplay amountXaf={3750.5} />)).toThrow();
    expect(() => renderToStaticMarkup(<MoneyDisplay amountXaf={Number.NaN} />)).toThrow();
    expect(() => renderToStaticMarkup(<MoneyDisplay amountXaf={-1} />)).toThrow();
  });

  it("expose le montant brut pour les tests de bout en bout", () => {
    expect(renderToStaticMarkup(<MoneyDisplay amountXaf={12250} />)).toContain(
      'data-amount-xaf="12250"',
    );
  });
});

/* ═════════════════ ProofChecklist ═════════════════ */

const ITEMS: ProofCheckItem[] = [
  {
    id: "1",
    title: "Format opérateur reconnu",
    explanation: "Le message vient bien de MTN.",
    state: "pass",
  },
  { id: "2", title: "Montant conforme", explanation: "Il manque 500 FCFA.", state: "fail" },
  { id: "3", title: "Contrepartie", explanation: "Le numéro ne correspond pas.", state: "warn" },
  {
    id: "7",
    title: "Contre-signature",
    explanation: "L'acheteuse n'a pas encore confirmé.",
    state: "pending",
  },
];

describe("ProofChecklist", () => {
  const html = renderToStaticMarkup(<ProofChecklist items={ITEMS} />);

  it("porte les quatre etats visuels", () => {
    for (const s of ["pass", "fail", "warn", "pending"]) {
      expect(html).toContain(`data-state="${s}"`);
    }
  });

  it("dit l'etat EN TEXTE : la couleur ne le porte jamais seule", () => {
    for (const label of ["Vérifié", "Refusé", "À vérifier", "En attente"]) {
      expect(html).toContain(label);
    }
  });

  it("est une liste ordonnee — la numerotation des sept controles fait foi", () => {
    expect(html).toMatch(/^<ol/);
  });

  it("affiche l'explication en langue simple, pas seulement le titre", () => {
    expect(html).toContain("Il manque 500 FCFA.");
    expect(html).toContain("L&#x27;acheteuse n&#x27;a pas encore confirmé.");
  });

  it("numerote les lignes, et sait ne pas le faire", () => {
    expect(html).toContain("1.");
    expect(renderToStaticMarkup(<ProofChecklist items={ITEMS} numbered={false} />)).not.toContain(
      ">1.<",
    );
  });
});

/* ═════════════════ Les quatre etats d'ecran ═════════════════ */

describe("les quatre etats obligatoires de chaque ecran", () => {
  it("l'erreur est annoncee comme telle aux lecteurs d'ecran", () => {
    expect(renderToStaticMarkup(<ErrorState>Réessayez.</ErrorState>)).toContain('role="alert"');
  });

  it("le vide et le hors ligne sont des status, pas des alertes", () => {
    expect(renderToStaticMarkup(<EmptyState>Ajoutez un article.</EmptyState>)).toContain(
      'role="status"',
    );
    expect(renderToStaticMarkup(<OfflineState />)).toContain('role="status"');
  });

  it("le hors ligne explique que ce qui est ouvert reste lisible", () => {
    // Le ton compte : perdre le reseau au Cameroun n'est pas une panne.
    expect(renderToStaticMarkup(<OfflineState />)).toContain("reste lisible");
  });

  it("le chargement porte aria-busy et un libelle lisible", () => {
    const html = renderToStaticMarkup(<LoadingState />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Chargement");
  });
});

describe("StatusBadge", () => {
  it("affiche toujours le libelle en texte", () => {
    const html = renderToStaticMarkup(<StatusBadge tone="good" label="Prouvé" />);
    expect(html).toContain("Prouvé");
    expect(html).toContain('data-tone="good"');
  });
});

/* ═════════════════ contraintes de poids ═════════════════ */

describe("le socle reste leger", () => {
  it("aucun composant n'importe Motion, lucide, clsx ni tailwind-merge", () => {
    const interdits =
      /(from\s+["'](motion|framer-motion|lucide-react|clsx|tailwind-merge|class-variance-authority))/;
    for (const f of [
      "index.ts",
      "cx.ts",
      "blocks.tsx",
      "money-display.tsx",
      "proof-checklist.tsx",
      "sms-paste-field.tsx",
      "primitives/basics.tsx",
      "primitives/overlays.tsx",
    ]) {
      expect(code(f), `dependance de style interdite dans ${f}`).not.toMatch(interdits);
    }
  });

  it("les icones sont des SVG en ligne", () => {
    expect(read("blocks.tsx")).toMatch(/<svg/);
    expect(read("proof-checklist.tsx")).toMatch(/<svg/);
  });
});
