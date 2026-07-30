import { describe, expect, it } from "vitest";
import {
  dimensionsCibles,
  formatOctets,
  IMAGE_PLUS_GRAND_COTE,
  productDraftSchema,
  productOrderSchema,
  productPatchSchema,
} from "../product.ts";

describe("productDraftSchema", () => {
  it("accepte le strict minimum : nom et prix", () => {
    const r = productDraftSchema.parse({ name: "Pagne wax 6 yards", priceXaf: 15000 });
    expect(r).toEqual({ name: "Pagne wax 6 yards", priceXaf: 15000 });
    // Le stock n'est PAS mis a zero par defaut : absent et zero ne sont pas la
    // meme chose. Beaucoup de vendeuses ne tiennent pas de stock.
    expect("stock" in r).toBe(false);
  });

  it("rogne le nom mais n'accepte pas un nom vide de sens", () => {
    expect(productDraftSchema.parse({ name: "  Sac  ", priceXaf: 100 }).name).toBe("Sac");
    expect(productDraftSchema.safeParse({ name: " a ", priceXaf: 100 }).success).toBe(false);
  });

  it("refuse un prix a virgule — le franc CFA n'a pas de sous-unite", () => {
    const r = productDraftSchema.safeParse({ name: "Sac", priceXaf: 1500.5 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/entier/);
  });

  it("refuse un prix a zero ou negatif", () => {
    for (const priceXaf of [0, -1, -15000]) {
      expect(productDraftSchema.safeParse({ name: "Sac", priceXaf }).success, `${priceXaf}`).toBe(
        false,
      );
    }
  });

  it("refuse un stock fractionnaire", () => {
    expect(productDraftSchema.safeParse({ name: "Sac", priceXaf: 100, stock: 1.5 }).success).toBe(
      false,
    );
  });
});

describe("productPatchSchema", () => {
  it("accepte un seul champ", () => {
    expect(productPatchSchema.parse({ priceXaf: 9000 })).toEqual({ priceXaf: 9000 });
  });

  it("refuse une modification vide — la requete ne voudrait rien dire", () => {
    expect(productPatchSchema.safeParse({}).success).toBe(false);
  });
});

describe("productOrderSchema", () => {
  it("prend la liste ORDONNEE complete", () => {
    expect(productOrderSchema.parse({ ids: ["b", "a", "c"] }).ids).toEqual(["b", "a", "c"]);
  });

  it("refuse une liste vide", () => {
    expect(productOrderSchema.safeParse({ ids: [] }).success).toBe(false);
  });
});

describe("dimensionsCibles", () => {
  it("ramene le plus grand cote a 640 en conservant le rapport", () => {
    // Photo de telephone en portrait : 3000x4000.
    expect(dimensionsCibles(3000, 4000)).toEqual({ largeur: 480, hauteur: 640 });
    // La meme en paysage.
    expect(dimensionsCibles(4000, 3000)).toEqual({ largeur: 640, hauteur: 480 });
  });

  it("N'AGRANDIT JAMAIS — une petite image reste petite", () => {
    // Agrandir couterait du forfait pour du flou.
    expect(dimensionsCibles(300, 200)).toEqual({ largeur: 300, hauteur: 200 });
    expect(dimensionsCibles(640, 640)).toEqual({ largeur: 640, hauteur: 640 });
  });

  it("ne rend jamais une dimension a zero", () => {
    // 8000x1 : le facteur ecraserait la hauteur sous 1.
    const d = dimensionsCibles(8000, 1);
    expect(d.largeur).toBe(640);
    expect(d.hauteur).toBe(1);
  });

  it("garde le plus grand cote sous la borne pour mille formats", () => {
    for (let i = 0; i < 1000; i++) {
      const l = 1 + ((i * 37) % 6000);
      const h = 1 + ((i * 53) % 6000);
      const d = dimensionsCibles(l, h);
      expect(Math.max(d.largeur, d.hauteur)).toBeLessThanOrEqual(IMAGE_PLUS_GRAND_COTE);
      expect(d.largeur).toBeGreaterThan(0);
      expect(d.hauteur).toBeGreaterThan(0);
      // Le rapport est conserve a l'arrondi pres. On le verifie sur les PIXELS
      // et non sur le quotient : a rapport extreme (8000x1), le plancher a 1 px
      // deforme forcement le quotient, et comparer des quotients de plusieurs
      // milliers avec une tolerance absolue ne veut rien dire.
      const facteur = Math.min(1, IMAGE_PLUS_GRAND_COTE / Math.max(l, h));
      expect(Math.abs(d.largeur - l * facteur)).toBeLessThanOrEqual(1);
      expect(Math.abs(d.hauteur - h * facteur)).toBeLessThanOrEqual(1);
    }
  });

  it("leve sur des dimensions absurdes plutot que de deviner", () => {
    expect(() => dimensionsCibles(0, 100)).toThrow();
    expect(() => dimensionsCibles(-5, 100)).toThrow();
  });
});

describe("formatOctets", () => {
  it("compte en unites DECIMALES — c'est ainsi que se vendent les forfaits", () => {
    // 1 Ko = 1 000 octets, pas 1 024 : afficher des kibi-octets serait exact et
    // inutile pour une vendeuse qui compare a son forfait.
    expect(formatOctets(1000)).toBe("1 Ko");
    expect(formatOctets(80_000)).toBe("80 Ko");
    expect(formatOctets(701_000)).toBe("701 Ko");
    expect(formatOctets(2_000_000)).toBe("2 Mo");
  });

  it("garde les tres petits poids en octets", () => {
    expect(formatOctets(1)).toBe("1 o");
    expect(formatOctets(999)).toBe("999 o");
  });

  it("rend le gain de l'exemple du blueprint", () => {
    expect(`${formatOctets(701_000)} → ${formatOctets(80_000)}`).toBe("701 Ko → 80 Ko");
  });
});
