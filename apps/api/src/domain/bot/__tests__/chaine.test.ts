import { describe, expect, it } from "vitest";
import { demandeChaine, demandeRetraitChaine, lireLienChaine } from "../chaine.ts";

/**
 * La chaine WhatsApp de la vendeuse — ADR 0061, rang 3b.
 *
 * Catalog ne cree ni n'alimente aucune chaine : il RANGE un lien, le montre
 * sur la page, et fournit des munitions marquees. Ce qui se teste ici est donc
 * la lecture du lien — et surtout ce qu'elle refuse.
 */

const ID = "0029VaAbCdEfGhIjKlMnOp";

describe("le lien de chaine", () => {
  /**
   * **La canonisation est le point.** Deux vendeuses collant la meme chaine —
   * l'une depuis le partage mobile, l'autre depuis le web — doivent produire
   * la MEME chaine de caracteres, sinon la page publique et la carte
   * afficheraient deux liens pour une seule chaine.
   */
  it("ramene toutes les formes de partage a une seule", () => {
    const attendu = `https://whatsapp.com/channel/${ID}`;
    for (const forme of [
      `https://whatsapp.com/channel/${ID}`,
      `http://whatsapp.com/channel/${ID}`,
      `https://www.whatsapp.com/channel/${ID}`,
      `whatsapp.com/channel/${ID}`,
      `  https://whatsapp.com/channel/${ID}/  `,
      `WhatsApp.com/Channel/${ID}`,
    ]) {
      expect(lireLienChaine(forme)).toBe(attendu);
    }
  });

  /**
   * Les parametres de suivi viennent du partage, pas du lien. Les republier
   * ferait porter a la boutique les traces d'un tiers.
   */
  it("retire les parametres de suivi", () => {
    expect(lireLienChaine(`https://whatsapp.com/channel/${ID}?utm_source=x&fbclid=y`)).toBe(
      `https://whatsapp.com/channel/${ID}`,
    );
  });

  it("REFUSE ce qui n'est pas une chaine WhatsApp", () => {
    for (const faux of [
      "",
      "   ",
      "https://whatsapp.com/channel/",
      "https://wa.me/237690000000",
      "https://whatsapp.com/group/abc",
      "https://not-whatsapp.com/channel/abc",
      "https://whatsapp.com.evil.test/channel/abc",
      `https://whatsapp.com/channel/${ID}/extra`,
      "ma chaine",
    ]) {
      expect(lireLienChaine(faux)).toBeNull();
    }
  });

  /**
   * On n'invente pas de format plus strict que ce qu'on a vu. Un motif trop
   * serre rejetterait un lien valide sans qu'une vendeuse puisse comprendre
   * pourquoi — alors qu'un lien accepte a tort produit une page qui pointe
   * ailleurs, ce qui se voit et se corrige.
   */
  it("accepte un identifiant d'une autre longueur ou d'un autre alphabet", () => {
    expect(lireLienChaine("https://whatsapp.com/channel/Ab-1_2")).toBe(
      "https://whatsapp.com/channel/Ab-1_2",
    );
  });
});

describe("les deux gestes", () => {
  it("reconnait la demande, accents et casse compris", () => {
    for (const t of ["ma chaîne", "Ma Chaine", "  chaîne  ", "channel"]) {
      expect(demandeChaine(t)).toBe(true);
    }
    for (const t of ["ma chaine est cassee", "chaines", "ma boutique"]) {
      expect(demandeChaine(t)).toBe(false);
    }
  });

  /** Le geste inverse existe toujours : elle reprend son lien quand elle veut. */
  it("reconnait le retrait", () => {
    for (const t of ["retirer", "supprimer", "aucune"]) {
      expect(demandeRetraitChaine(t)).toBe(true);
    }
    expect(demandeRetraitChaine("retirer la chaine de montagne")).toBe(false);
  });
});
