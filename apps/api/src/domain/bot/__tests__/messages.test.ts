import { describe, expect, it } from "vitest";
import { boutons, image, liste, texte } from "../messages.ts";

/**
 * Les constructeurs de messages sortants — ADR 0031.
 *
 * Les limites de l'API WhatsApp (3 boutons, 10 lignes de liste, titres
 * courts) ne sont pas des recommandations : un depassement est un refus HTTP
 * au moment d'envoyer, c'est-a-dire une conversation qui meurt en silence
 * pour l'acheteuse. Elles sont donc tenues ICI, par le domaine, testees —
 * et pour les textes qui viennent des DONNEES (nom d'article d'une
 * vendeuse), la regle est la troncature propre, jamais la levee : une
 * vendeuse au nom d'article trop long doit vendre quand meme.
 */

describe("texte", () => {
  it("construit un message texte au format Cloud API", () => {
    const m = texte("237690112233", "Bonjour");
    expect(m).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "237690112233",
      type: "text",
      text: { body: "Bonjour", preview_url: false },
    });
  });

  it("refuse un corps vide — un message sans texte est un bogue d'appelant", () => {
    expect(() => texte("237690112233", "")).toThrow(/corps/);
    expect(() => texte("237690112233", "   ")).toThrow(/corps/);
  });

  it("tronque a 4096 caracteres sans couper au milieu d'un mot invisible", () => {
    const long = "a".repeat(5000);
    const m = texte("237690112233", long);
    expect(m.text.body.length).toBeLessThanOrEqual(4096);
    expect(m.text.body.endsWith("…")).toBe(true);
  });
});

describe("boutons", () => {
  it("construit un message interactif a boutons", () => {
    const m = boutons("237690112233", "Choisissez", [
      { id: "cmd", titre: "Commander" },
      { id: "retour", titre: "Retour" },
    ]);
    expect(m.interactive.type).toBe("button");
    expect(m.interactive.action.buttons).toHaveLength(2);
    expect(m.interactive.action.buttons[0]).toEqual({
      type: "reply",
      reply: { id: "cmd", title: "Commander" },
    });
  });

  it("porte un en-tete image quand une URL est fournie, rien sinon", () => {
    const avec = boutons("2376", "x", [{ id: "a", titre: "A" }], {
      image: "https://o.test/p.jpg",
    });
    expect(avec.interactive.header).toEqual({
      type: "image",
      image: { link: "https://o.test/p.jpg" },
    });
    const sans = boutons("2376", "x", [{ id: "a", titre: "A" }]);
    expect("header" in sans.interactive).toBe(false);
  });

  it("refuse zero bouton et refuse plus de trois — la limite API est dure", () => {
    expect(() => boutons("2376", "x", [])).toThrow(/bouton/);
    const quatre = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, titre: `B${i}` }));
    expect(() => boutons("2376", "x", quatre)).toThrow(/trois/);
  });

  it("tronque un TITRE de bouton venu des donnees a 20 caracteres", () => {
    const m = boutons("2376", "x", [
      { id: "a", titre: "Un titre beaucoup trop long pour un bouton" },
    ]);
    const titre = m.interactive.action.buttons[0]?.reply.title as string;
    expect(titre.length).toBeLessThanOrEqual(20);
    expect(titre.endsWith("…")).toBe(true);
  });

  it("refuse un identifiant vide ou en double — le routage en depend", () => {
    expect(() => boutons("2376", "x", [{ id: "", titre: "A" }])).toThrow(/identifiant/);
    expect(() =>
      boutons("2376", "x", [
        { id: "a", titre: "A" },
        { id: "a", titre: "B" },
      ]),
    ).toThrow(/double/);
  });
});

describe("liste", () => {
  const lignes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `art-${i}`, titre: `Article ${i}` }));

  it("construit un message liste avec son bouton d'ouverture", () => {
    const m = liste("2376", "Le catalogue", "Voir les articles", lignes(3));
    expect(m.interactive.type).toBe("list");
    expect(m.interactive.action.button).toBe("Voir les articles");
    expect(m.interactive.action.sections[0]?.rows).toHaveLength(3);
  });

  it("refuse plus de dix lignes — la pagination est le travail de l'appelant", () => {
    expect(() => liste("2376", "x", "Voir", lignes(11))).toThrow(/dix/);
  });

  it("tronque titres (24) et descriptions (72) venus des donnees", () => {
    const m = liste("2376", "x", "Voir", [
      {
        id: "a",
        titre: "Huile de coco pressee a froid du village",
        description: "d".repeat(100),
      },
    ]);
    const ligne = m.interactive.action.sections[0]?.rows[0];
    expect(ligne?.title.length ?? 99).toBeLessThanOrEqual(24);
    expect(ligne?.description?.length ?? 99).toBeLessThanOrEqual(72);
  });

  it("le prix en description n'est jamais tronque : il passe en premier", () => {
    // La description composee « 15 000 FCFA — <reste> » garde toujours le
    // montant entier : c'est l'information que l'acheteuse compare.
    const m = liste("2376", "x", "Voir", [
      { id: "a", titre: "Pagne", description: `15 000 FCFA — ${"x".repeat(100)}` },
    ]);
    expect(m.interactive.action.sections[0]?.rows[0]?.description).toMatch(/^15 000 FCFA/);
  });
});

describe("image — la photo pleine largeur (ADR 0035)", () => {
  it("porte le lien et la legende, sans champ vide", () => {
    const m = image("237690112233", "https://o/p.jpg", "Pagne — 15 000 FCFA");
    expect(m.type).toBe("image");
    expect(m.image.link).toBe("https://o/p.jpg");
    expect(m.image.caption).toBe("Pagne — 15 000 FCFA");

    const sans = image("237690112233", "https://o/p.jpg");
    expect(sans.image.caption).toBeUndefined();
  });

  it("tronque une legende de vendeuse au plafond de l'API, sans lever", () => {
    const longue = "x".repeat(2000);
    const m = image("237690112233", "https://o/p.jpg", longue);
    expect((m.image.caption ?? "").length).toBeLessThanOrEqual(1024);
    expect(m.image.caption?.endsWith("…")).toBe(true);
  });

  it("refuse un lien vide : un message image sans image n'existe pas", () => {
    expect(() => image("237690112233", "  ")).toThrow();
  });
});
