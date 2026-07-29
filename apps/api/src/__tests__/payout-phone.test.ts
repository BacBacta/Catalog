import { describe, expect, it } from "vitest";
import {
  appliquerChangementReversement,
  operateurDuNumero,
  type PayoutChangeRequest,
  type SellerPayoutState,
} from "../domain/payout-phone.ts";

/**
 * Le numero de reversement est le champ qu'un attaquant chercherait a
 * detourner : c'est la que l'argent arrive. Toute modification exige un OTP
 * envoye AU NOUVEAU NUMERO, et chaque tentative — reussie ou non — est
 * journalisee.
 *
 * Le temps est un parametre. Le domaine n'ecrit rien : il renvoie la decision
 * ET l'entree de journal, que la couche applicative persiste.
 */

const NOW = new Date(Date.UTC(2026, 6, 29, 10, 0, 0));
const il_y_a = (min: number) => new Date(NOW.getTime() - min * 60_000);

const VENDEUSE: SellerPayoutState = {
  sellerId: "s1",
  /** Numero de CONNEXION : MTN. */
  loginPhone: "+237677000101",
  /** Numero de REVERSEMENT actuel : Orange. La double SIM est la norme. */
  payoutPhone: "+237699000101",
  payoutPhoneVerifiedAt: il_y_a(60 * 24 * 30),
};

const demande = (over: Partial<PayoutChangeRequest> = {}): PayoutChangeRequest => ({
  nouveauNumero: "+237699555444",
  verification: { numero: "+237699555444", verifieA: il_y_a(1) },
  acteur: { role: "vendeuse", ip: "41.202.0.1" },
  now: NOW,
  ...over,
});

describe("changement du numero de reversement", () => {
  it("accepte un changement dont l'OTP porte sur le NOUVEAU numero", () => {
    const r = appliquerChangementReversement(VENDEUSE, demande());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changes.payoutPhone).toBe("+237699555444");
    expect(r.changes.payoutPhoneVerifiedAt).toEqual(NOW);
    expect(r.changes.payoutOperator).toBe("orange");
  });

  it("REFUSE un changement sans aucune verification — et le journalise", () => {
    // C'est le cas central de la definition de terminé du lot 4.
    const r = appliquerChangementReversement(VENDEUSE, demande({ verification: null }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.raison).toBe("verification_absente");
    expect(r.journal.kind).toBe("reversement_refuse");
    expect(r.journal.payload.raison).toBe("verification_absente");
  });

  it("journalise TOUTE tentative, refusee comme acceptee", () => {
    // Une tentative refusee non journalisee, c'est une attaque invisible.
    const ok = appliquerChangementReversement(VENDEUSE, demande());
    const ko = appliquerChangementReversement(VENDEUSE, demande({ verification: null }));
    expect(ok.journal.kind).toBe("reversement_modifie");
    expect(ko.journal.kind).toBe("reversement_refuse");
    for (const j of [ok.journal, ko.journal]) {
      expect(j.sellerId).toBe("s1");
      expect(j.at).toEqual(NOW);
      expect(j.actor).toBe("vendeuse");
    }
  });

  it("REFUSE un OTP verifie pour un AUTRE numero", () => {
    // L'attaque evidente : faire verifier son propre numero, puis pousser
    // celui de l'attaquant.
    const r = appliquerChangementReversement(
      VENDEUSE,
      demande({ verification: { numero: "+237677000101", verifieA: il_y_a(1) } }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.raison).toBe("verification_dun_autre_numero");
  });

  it("REFUSE une verification perimee", () => {
    const r = appliquerChangementReversement(
      VENDEUSE,
      demande({ verification: { numero: "+237699555444", verifieA: il_y_a(60) } }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.raison).toBe("verification_perimee");
  });

  it("REFUSE un numero non camerounais", () => {
    const r = appliquerChangementReversement(
      VENDEUSE,
      demande({
        nouveauNumero: "+33612345678",
        verification: { numero: "+33612345678", verifieA: il_y_a(1) },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.raison).toBe("numero_invalide");
  });

  it("REFUSE un numero identique a l'actuel — rien a changer", () => {
    const r = appliquerChangementReversement(
      VENDEUSE,
      demande({
        nouveauNumero: VENDEUSE.payoutPhone as string,
        verification: { numero: VENDEUSE.payoutPhone as string, verifieA: il_y_a(1) },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.raison).toBe("numero_inchange");
  });

  it("accepte que le reversement SOIT le numero de connexion, si c'est voulu", () => {
    // Ce n'est pas la norme mais c'est legitime : une vendeuse mono-SIM.
    // Le champ reste distinct, c'est tout ce qu'exige le contrat.
    const sansReversement: SellerPayoutState = {
      ...VENDEUSE,
      payoutPhone: null,
      payoutPhoneVerifiedAt: null,
    };
    const r = appliquerChangementReversement(
      sansReversement,
      demande({
        nouveauNumero: sansReversement.loginPhone,
        verification: { numero: sansReversement.loginPhone, verifieA: il_y_a(1) },
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("le journal ne contient JAMAIS le code OTP", () => {
    const r = appliquerChangementReversement(VENDEUSE, demande());
    expect(JSON.stringify(r.journal)).not.toMatch(/code|otp/i);
  });

  it("le journal garde l'ancien ET le nouveau numero — sinon on ne peut rien reconstituer", () => {
    const r = appliquerChangementReversement(VENDEUSE, demande());
    expect(r.journal.payload.ancien).toBe("+237699000101");
    expect(r.journal.payload.nouveau).toBe("+237699555444");
  });
});

describe("operateurDuNumero", () => {
  it("reconnait MTN et Orange sur les prefixes camerounais", () => {
    // 67 et 650-654 chez MTN ; 69 et 655-659 chez Orange.
    expect(operateurDuNumero("+237677123456")).toBe("mtn");
    expect(operateurDuNumero("+237650123456")).toBe("mtn");
    expect(operateurDuNumero("+237699123456")).toBe("orange");
    expect(operateurDuNumero("+237655123456")).toBe("orange");
  });

  it("renvoie null quand le prefixe n'est pas concluant plutot que de deviner", () => {
    // Camtel, ou un prefixe qu'on ne connait pas encore. Deviner ici
    // afficherait un mauvais logo a la vendeuse, et pire, un mauvais code USSD.
    expect(operateurDuNumero("+237222123456")).toBeNull();
    expect(operateurDuNumero("+33612345678")).toBeNull();
  });
});
