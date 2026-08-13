import { describe, expect, it } from "vitest";
import { deliverySchema } from "../delivery.ts";
import { formatPhone, normalizePhone } from "../phone.ts";
import { VILLE_MAX, VILLE_MIN, villeAcceptable, villeDouteuse } from "../villes.ts";

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

/**
 * Le format du numero — ADR 0051.
 *
 * Le bot AFFICHAIT « 6 90 11 22 33 » et REFUSAIT cette meme ecriture a la
 * saisie : l'acheteuse recopiait le recapitulatif, c'etait rejete, elle
 * relisait sans voir la difference, et recommencait.
 *
 * L'affichage s'aligne sur les douze exemples des copies. Les TROIS premiers
 * chiffres identifient l'operateur — 69x Orange, 67x/68x MTN, 62x Nexttel —
 * et l'operateur decide du code USSD, des frais hors reseau et de quel SMS
 * fera preuve. Les grouper garde cette information lisible.
 */
describe("formatPhone groupe par l'operateur", () => {
  it("rend la forme des exemples du produit", () => {
    expect(formatPhone("+237690112233")).toBe("690 11 22 33");
    expect(formatPhone("690112233")).toBe("690 11 22 33");
  });

  it("l'ecriture qu'il rend est celle qu'il accepte — la boucle est fermee", () => {
    /* La propriete qui manquait : ce que le bot montre, il doit savoir le
       relire. Le detail de la saisie vit dans le bot, mais la forme rendue
       ici est celle que l'acheteuse recopie. */
    expect(normalizePhone(formatPhone("+237690112233"))).toBe("+237690112233");
  });

  it("un numero illisible ressort tel quel, sans etre maquille", () => {
    expect(formatPhone("pas un numero")).toBe("pas un numero");
  });
});

/**
 * Le prefixe `00237` — ADR 0055.
 *
 * Il est la forme composee depuis un fixe, et il circule. Le bot le tolerait
 * de son cote depuis l'ADR 0051 ; `normalizePhone` le refusait, si bien qu'un
 * meme numero passait par un chemin et pas par l'autre.
 */
describe("normalizePhone accepte toutes les ecritures qui circulent", () => {
  it("les cinq formes rendent le meme numero", () => {
    for (const forme of [
      "690112233",
      "690 11 22 33",
      "6 90 11 22 33",
      "+237690112233",
      "237690112233",
      "00237690112233",
    ]) {
      expect(normalizePhone(forme), forme).toBe("+237690112233");
    }
  });

  it("ce qui n'est pas camerounais reste refuse", () => {
    for (const faux of ["+33612345678", "0612345678", "12345", ""]) {
      expect(normalizePhone(faux), faux).toBeNull();
    }
  });
});

describe("villeDouteuse — la FORME, jamais le vocabulaire (ADR 0091)", () => {
  it("laisse passer tout ce qui ressemble a un lieu, connu ou non", () => {
    /* Le point entier du predicat : il ne connait aucune ville, et n'en exclut
       aucune. Foumbot, Kribi, Ngaoundere passent — comme n'importe quel
       toponyme que personne ici n'a jamais entendu. C'est ce qui le distingue
       de la liste que l'ADR 0050 a refusee. */
    for (const v of [
      "Douala",
      "Yaoundé",
      "Bafoussam",
      "Foumbot",
      "Kribi",
      "Ngaoundéré",
      "Douala 5e",
      "Bonaberi",
      "Douala Bonaberi carrefour Total Ndokoti",
      "Buea",
      "Garoua-Boulaï",
    ]) {
      expect(villeDouteuse(v), v).toBe(false);
    }
  });

  it("attrape la question posee au bot — le constat C-001", () => {
    expect(villeDouteuse("est-ce que vous vendez des chaussures pour bébé ?")).toBe(true);
    expect(villeDouteuse("vous avez du 38 ?")).toBe(true);
  });

  it("attrape une saisie sans une seule lettre", () => {
    for (const v of ["12345", "?? ...", "...", "690112233"]) {
      expect(villeDouteuse(v), v).toBe(true);
    }
  });

  it("attrape un lien colle", () => {
    expect(villeDouteuse("https://exemple.test/bonjour")).toBe(true);
    expect(villeDouteuse("www.exemple.test")).toBe(true);
  });

  it("attrape une phrase, au-dela de cinq mots", () => {
    expect(villeDouteuse("c'est trop cher pour moi merci")).toBe(true);
    /* Cinq mots exactement : on ne demande PAS. Le seuil est genereux a dessein. */
    expect(villeDouteuse("Douala Bonaberi carrefour Total Ndokoti")).toBe(false);
  });

  it("une saisie vide n'est pas douteuse — elle est deja refusee ailleurs", () => {
    /* Deux predicats, deux roles : `villeAcceptable` refuse, `villeDouteuse`
       fait demander. Les confondre ferait poser une question sur du vide. */
    expect(villeDouteuse("")).toBe(false);
    expect(villeDouteuse("   ")).toBe(false);
    expect(villeAcceptable("")).toBe(false);
  });
});
