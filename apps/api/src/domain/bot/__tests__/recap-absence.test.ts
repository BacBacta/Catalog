import { describe, expect, it } from "vitest";
import { estResumable, RECAP_SUJETS_MAX, recapAbsence } from "../notifications.ts";

/**
 * Le recapitulatif d'absence — ADR 0105.
 *
 * Une vendeuse qui revient apres une bonne journee recevait jusqu'a cinq
 * notifications d'affilee, une par commande, melees a sa conversation. Le
 * recapitulatif les remplace par UN message : une ligne par evenement, puis ou
 * trouver le detail. Meta n'a rien pour ca — l'API Cloud ne connait que le
 * message — donc c'est a nous de le tenir.
 */

const CORPS_COMMANDE = (ref: string) =>
  `🛍️ *${ref} est créée.*\n1× Robe wax — 15 000 F\nAcompte attendu : 7 500 F\nNuméro à appeler pour la remise : +237677001122`;

describe("recapAbsence — un message, une ligne par événement", () => {
  it("moins de deux notifications : pas de récapitulatif — le message entier part", () => {
    expect(recapAbsence([])).toBeNull();
    expect(recapAbsence([CORPS_COMMANDE("CT-240001")])).toBeNull();
  });

  it("trois commandes : trois titres, le compte, et où trouver le détail", () => {
    const r = recapAbsence([
      CORPS_COMMANDE("CT-240001"),
      CORPS_COMMANDE("CT-240002"),
      CORPS_COMMANDE("CT-240003"),
    ]);
    expect(r).not.toBeNull();
    expect(r).toContain("3 nouvelles");
    expect(r).toContain("· 🛍️ *CT-240001 est créée.*");
    expect(r).toContain("· 🛍️ *CT-240003 est créée.*");
    /* La PREMIERE ligne seulement : le detail ne se recopie pas, il vit dans
       la commande, que l'espace vendeuse affiche. */
    expect(r).not.toContain("Acompte attendu");
    expect(r).toContain("espace vendeuse");
  });

  it("le récapitulatif ne promet AUCUN geste que le bot ne connaît pas", () => {
    /* La faute de « Voir une boutique » (ADR 0103, 0104) : annoncer un mot
       qui ne mene nulle part. « commandes » n'existe pas encore dans le fil —
       tant qu'il n'existe pas, le recapitulatif n'a pas le droit de l'ecrire. */
    const r = recapAbsence([CORPS_COMMANDE("CT-1"), CORPS_COMMANDE("CT-2")]) ?? "";
    expect(r).not.toMatch(/écrivez \*?commandes\*?/i);
  });

  it("au-delà du plafond, le débordement est DIT, jamais avalé", () => {
    const beaucoup = Array.from({ length: RECAP_SUJETS_MAX + 3 }, (_, i) =>
      CORPS_COMMANDE(`CT-24${String(i).padStart(4, "0")}`),
    );
    const r = recapAbsence(beaucoup) ?? "";
    expect(r).toContain(`${RECAP_SUJETS_MAX + 3} nouvelles`);
    expect(r).toContain("… et 3 de plus, au prochain message.");
    /* Le onzieme titre n'y est pas : il attend, il n'est pas perdu. */
    expect((r.match(/^· /gm) ?? []).length).toBe(RECAP_SUJETS_MAX);
  });

  it("une première ligne démesurée est coupée, pas rejetée", () => {
    const long = `${"x".repeat(200)}\nsuite`;
    const r = recapAbsence([long, CORPS_COMMANDE("CT-1")]) ?? "";
    expect(r).toContain("…");
    for (const ligne of r.split("\n").filter((l) => l.startsWith("· "))) {
      expect(ligne.length).toBeLessThanOrEqual(92);
    }
  });
});

describe("estResumable — ce qui garde son message entier", () => {
  it("une notification à boutons ne se résume jamais — le bouton EST le message", () => {
    expect(estResumable("✅ *CT-1 : paiement prouvé.*", true)).toBe(false);
  });

  it("un avertissement ne se résume jamais — une contestation gèle une commande", () => {
    expect(estResumable("⚠️ *CT-1 est contestée.*\nLa commande est gelée.", false)).toBe(false);
    expect(estResumable("  ⚠️ décalé par une espace", false)).toBe(false);
  });

  it("une notification de commande ordinaire se résume", () => {
    expect(estResumable(CORPS_COMMANDE("CT-1"), false)).toBe(true);
  });
});
