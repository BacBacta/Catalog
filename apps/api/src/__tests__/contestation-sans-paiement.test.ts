import { describe, expect, it } from "vitest";
import { appliquerEvenement } from "../domain/proof/machine.ts";

/**
 * On ne conteste pas un paiement qui n'existe pas.
 *
 * Le banc du 11/08/2026 : commande creee a 10:08:17, contestee a 10:08:47 —
 * trente secondes plus tard, depuis le lien de suivi, sur une commande
 * `sans_prepaiement` ou RIEN n'avait ete paye. Le bouton etait la, il a ete
 * appuye, et la commande est morte : plus de contre-signature, plus d'avis,
 * recu refuse, aucun retour possible.
 *
 * « Contester » veut dire « ce paiement n'est pas de moi ». Sur `attendu`, il
 * n'y a aucun paiement a desavouer — l'acheteuse qui appuie veut dire tout
 * autre chose, et le produit lui fait signer un litige.
 */

const T = new Date("2026-08-11T10:08:47.000Z");

describe("contester exige un paiement a contester", () => {
  it("REFUSE depuis « attendu » — rien n'a ete paye", () => {
    const r = appliquerEvenement("attendu", { type: "contestation", par: "acheteuse" }, T);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toBe("contestation_sans_paiement");
    expect(r.etat).toBe("attendu");
  });

  it("le refus laisse une TRACE, comme tout refus", () => {
    const r = appliquerEvenement("attendu", { type: "contestation", par: "acheteuse" }, T);
    expect(r.journal.kind).toBe("preuve_refusee");
    expect(r.journal.vers).toBe("attendu");
  });

  it("ACCEPTE depuis « declare_non_trace » — quelqu'un affirme avoir recu de l'argent", () => {
    const r = appliquerEvenement(
      "declare_non_trace",
      { type: "contestation", par: "acheteuse" },
      T,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.etat).toBe("conteste");
  });

  it("ACCEPTE depuis « prouve » et « contresigne » — la preuve la plus forte reste contestable", () => {
    /* Sinon une collusion a deux voix serait definitive : c'est la raison
       d'etre du controle 7, et elle ne change pas. */
    for (const depart of ["prouve", "contresigne"] as const) {
      const r = appliquerEvenement(depart, { type: "contestation", par: "acheteuse" }, T);
      expect(r.ok, depart).toBe(true);
    }
  });

  it("REFUSE une seconde contestation, comme avant", () => {
    const r = appliquerEvenement("conteste", { type: "contestation", par: "acheteuse" }, T);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toBe("recul_ignore");
  });

  it("la vendeuse et le support sont soumis a la MEME regle", () => {
    for (const par of ["vendeuse", "support"] as const) {
      const r = appliquerEvenement("attendu", { type: "contestation", par }, T);
      expect(r.ok, par).toBe(false);
    }
  });
});
