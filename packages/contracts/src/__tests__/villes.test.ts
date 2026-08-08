import { describe, expect, it } from "vitest";
import { deliverySchema } from "../delivery.ts";
import { VILLE_MAX, VILLE_MIN, villeAcceptable } from "../villes.ts";

/**
 * La ville d'une boutique — ADR 0050.
 *
 * Le defaut, mesure le 07/08/2026 : `city: z.enum(["Douala", "Yaounde"])`.
 * Une boutique a Bafoussam ne pouvait JAMAIS vendre en livraison, et l'echec
 * ne tombait pas a l'inscription — il tombait chez l'ACHETEUSE, au dernier
 * appui, apres neuf tours. « Yaoundé » avec son accent echouait aussi.
 *
 * On n'ecrit pas une liste plus longue : elle deplacerait le mur a la
 * soixantieme ville. Un seul predicat, appele aux DEUX portes d'ecriture et
 * a la lecture — et un test qui interdit aux trois de diverger.
 */
describe("villeAcceptable — le predicat unique", () => {
  it("accepte les villes camerounaises, accents et traits d'union compris", () => {
    for (const v of ["Douala", "Yaoundé", "Bafoussam", "Buea", "Nanga-Eboko", "Ngaoundéré"]) {
      expect(villeAcceptable(v)).toBe(true);
    }
  });

  it("refuse le vide et le trop court", () => {
    for (const v of ["", " ", "  ", "D"]) expect(villeAcceptable(v)).toBe(false);
  });

  it("trime lui-meme — l'appelant n'a pas a s'en souvenir", () => {
    expect(villeAcceptable("  Douala  ")).toBe(true);
    expect(villeAcceptable(`  ${"a".repeat(VILLE_MAX)}  `)).toBe(true);
  });

  it("tient ses bornes", () => {
    expect(villeAcceptable("a".repeat(VILLE_MIN))).toBe(true);
    expect(villeAcceptable("a".repeat(VILLE_MIN - 1))).toBe(false);
    expect(villeAcceptable("a".repeat(VILLE_MAX))).toBe(true);
    expect(villeAcceptable("a".repeat(VILLE_MAX + 1))).toBe(false);
  });
});

describe("le schema de livraison suit le MEME predicat", () => {
  const base = {
    mode: "livraison" as const,
    quartier: "Banengo",
    landmark: "en face du marche A",
    phone: "+237690112233",
  };

  it("LE defaut du 07/08/2026 : une boutique hors des deux villes vend enfin", () => {
    for (const city of ["Bafoussam", "Yaoundé", "Buea", "Garoua", "Kribi", "Limbé"]) {
      expect(deliverySchema.safeParse({ ...base, city }).success).toBe(true);
    }
  });

  it("les deux villes d'avant marchent toujours — aucune commande en vol ne casse", () => {
    for (const city of ["Douala", "Yaounde"]) {
      expect(deliverySchema.safeParse({ ...base, city }).success).toBe(true);
    }
  });

  it("une ville vide reste refusee — on a elargi, pas ouvert en grand", () => {
    for (const city of ["", " ", "D"]) {
      expect(deliverySchema.safeParse({ ...base, city }).success).toBe(false);
    }
  });

  it("le schema RELIT sans reecrire : une ville stockee ressort telle quelle", () => {
    /* `.refine`, jamais `.trim()` : `deliverySchema` relit du JSON deja
       stocke, et un schema qui reecrit ce qu'il relit rend toute comparaison
       ininterpretable. */
    const lu = deliverySchema.safeParse({ ...base, city: " Douala " });
    expect(lu.success && lu.data.mode === "livraison" && lu.data.city).toBe(" Douala ");
  });

  it("le predicat et le schema ne peuvent pas diverger", () => {
    for (const v of ["Douala", "Bafoussam", "", "D", "a".repeat(VILLE_MAX + 1), " Buea "]) {
      expect(deliverySchema.safeParse({ ...base, city: v }).success).toBe(villeAcceptable(v));
    }
  });
});
