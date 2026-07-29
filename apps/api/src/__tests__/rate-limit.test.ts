import { describe, expect, it } from "vitest";
import {
  checkOtpRateLimit,
  DEFAULT_OTP_LIMITS,
  type OtpAttempt,
  prochainCreneau,
} from "../domain/rate-limit.ts";

/**
 * Un SMS coute de l'argent. Une boucle d'envoi non bridee est a la fois une
 * faille — on inonde un numero qui n'est pas le sien — et une facture.
 *
 * Le temps est un PARAMETRE, jamais `Date.now()` lu dans le domaine : sans ca
 * les tests deviennent non deterministes et personne ne sait plus pourquoi ils
 * echouent un mardi.
 */

const T = (min: number) => new Date(Date.UTC(2026, 6, 29, 10, 0, 0) + min * 60_000);
const PHONE = "+237677123456";
const IP = "41.202.0.1";

const essai = (min: number, phone = PHONE, ip = IP): OtpAttempt => ({ at: T(min), phone, ip });

/**
 * Affine l'union discriminee vers le cas « refuse ». Sans ca, chaque acces a
 * `reason` demande un `if (d.allowed) return;` qui alourdit la lecture — et un
 * test qui se lit mal se maintient mal.
 */
function refus(d: ReturnType<typeof checkOtpRateLimit>) {
  expect(d.allowed, "la demande devait etre refusee").toBe(false);
  if (d.allowed) throw new Error("inatteignable");
  return d;
}

describe("limitation de debit des OTP", () => {
  it("laisse passer les trois premieres demandes et BLOQUE la quatrieme", () => {
    const faits: OtpAttempt[] = [];
    for (let i = 0; i < 3; i++) {
      const d = checkOtpRateLimit(faits, { phone: PHONE, ip: IP, now: T(i) }, DEFAULT_OTP_LIMITS);
      expect(d.allowed, `demande ${i + 1} refusee a tort : ${d.allowed ? "" : d.reason}`).toBe(
        true,
      );
      faits.push(essai(i));
    }
    const quatrieme = refus(
      checkOtpRateLimit(faits, { phone: PHONE, ip: IP, now: T(3) }, DEFAULT_OTP_LIMITS),
    );
    expect(quatrieme.reason).toBe("trop_de_demandes_pour_ce_numero");
    expect(quatrieme.retryAfterMs).toBeGreaterThan(0);
  });

  it("rouvre apres la fenetre — un blocage n'est pas une sanction definitive", () => {
    const faits = [essai(0), essai(1), essai(2)];
    const fenetreMin = DEFAULT_OTP_LIMITS.parNumero.fenetreMs / 60_000;
    const apres = checkOtpRateLimit(
      faits,
      { phone: PHONE, ip: IP, now: T(fenetreMin + 1) },
      DEFAULT_OTP_LIMITS,
    );
    expect(apres.allowed).toBe(true);
  });

  it("compte par NUMERO : un autre numero n'est pas penalise", () => {
    const faits = [essai(0), essai(1), essai(2)];
    const autre = checkOtpRateLimit(
      faits,
      { phone: "+237699888777", ip: IP, now: T(3) },
      DEFAULT_OTP_LIMITS,
    );
    expect(autre.allowed).toBe(true);
  });

  it("compte aussi par IP : on ne contourne pas en changeant de numero", () => {
    // Sans limite par IP, un attaquant fait tourner les numeros depuis la meme
    // machine et vide le budget SMS en quelques minutes.
    const faits: OtpAttempt[] = [];
    for (let i = 0; i < DEFAULT_OTP_LIMITS.parIp.max; i++) {
      faits.push(essai(i * 0.1, `+2376771234${(10 + i).toString().slice(-2)}`, IP));
    }
    const d = refus(
      checkOtpRateLimit(faits, { phone: "+237699000999", ip: IP, now: T(5) }, DEFAULT_OTP_LIMITS),
    );
    expect(d.reason).toBe("trop_de_demandes_depuis_cette_adresse");
  });

  it("une IP differente n'herite pas du blocage", () => {
    const faits: OtpAttempt[] = [];
    for (let i = 0; i < DEFAULT_OTP_LIMITS.parIp.max; i++) {
      faits.push(essai(i * 0.1, `+2376771234${(10 + i).toString().slice(-2)}`, IP));
    }
    const d = checkOtpRateLimit(
      faits,
      { phone: "+237699000999", ip: "41.202.0.2", now: T(5) },
      DEFAULT_OTP_LIMITS,
    );
    expect(d.allowed).toBe(true);
  });

  it("un plafond JOURNALIER par numero survit a l'expiration des fenetres", () => {
    // Sinon il suffit d'attendre chaque fois la fin de la fenetre pour envoyer
    // un SMS toutes les quinze minutes, indefiniment.
    const faits: OtpAttempt[] = [];
    const pas = DEFAULT_OTP_LIMITS.parNumero.fenetreMs / 60_000 + 1;
    for (let i = 0; i < DEFAULT_OTP_LIMITS.parNumeroParJour.max; i++) {
      faits.push(essai(i * pas));
    }
    const d = refus(
      checkOtpRateLimit(
        faits,
        { phone: PHONE, ip: IP, now: T(DEFAULT_OTP_LIMITS.parNumeroParJour.max * pas) },
        DEFAULT_OTP_LIMITS,
      ),
    );
    expect(d.reason).toBe("plafond_journalier_du_numero");
  });

  it("le plafond journalier se remet a zero le lendemain", () => {
    const faits: OtpAttempt[] = [];
    for (let i = 0; i < DEFAULT_OTP_LIMITS.parNumeroParJour.max; i++) faits.push(essai(i * 16));
    const lendemain = checkOtpRateLimit(
      faits,
      { phone: PHONE, ip: IP, now: T(60 * 25) },
      DEFAULT_OTP_LIMITS,
    );
    expect(lendemain.allowed).toBe(true);
  });

  it("un plafond GLOBAL protege la facture, meme reparti sur mille numeros", () => {
    const faits: OtpAttempt[] = [];
    for (let i = 0; i < DEFAULT_OTP_LIMITS.globalParJour.max; i++) {
      faits.push(essai(i * 0.01, `+2376${(100000000 + i).toString()}`, `41.202.1.${i % 250}`));
    }
    const d = refus(
      checkOtpRateLimit(
        faits,
        { phone: "+237699111222", ip: "41.202.9.9", now: T(30) },
        DEFAULT_OTP_LIMITS,
      ),
    );
    expect(d.reason).toBe("plafond_journalier_global");
  });

  it("les limites sont ordonnees du plus specifique au plus general", () => {
    // Quand plusieurs limites sont atteintes, le motif renvoye doit etre celui
    // qui aide : « ton numero a trop demande », pas « le service est sature ».
    const faits: OtpAttempt[] = [];
    for (let i = 0; i < DEFAULT_OTP_LIMITS.globalParJour.max; i++) {
      faits.push(essai(i * 0.01, PHONE, IP));
    }
    const d = refus(
      checkOtpRateLimit(faits, { phone: PHONE, ip: IP, now: T(1) }, DEFAULT_OTP_LIMITS),
    );
    expect(d.reason).toBe("trop_de_demandes_pour_ce_numero");
  });
});

describe("prochainCreneau", () => {
  it("dit dans combien de temps reessayer, en secondes entieres", () => {
    const faits = [essai(0), essai(1), essai(2)];
    const d = refus(
      checkOtpRateLimit(faits, { phone: PHONE, ip: IP, now: T(3) }, DEFAULT_OTP_LIMITS),
    );
    const s = prochainCreneau(d);
    expect(s).toBeGreaterThan(0);
    expect(Number.isInteger(s)).toBe(true);
  });

  it("vaut zero quand la demande est autorisee", () => {
    expect(prochainCreneau({ allowed: true })).toBe(0);
  });
});

describe("le domaine ne lit pas l'horloge", () => {
  it("deux appels identiques donnent le meme resultat", () => {
    const faits = [essai(0), essai(1), essai(2)];
    const args = { phone: PHONE, ip: IP, now: T(3) } as const;
    expect(checkOtpRateLimit(faits, args, DEFAULT_OTP_LIMITS)).toEqual(
      checkOtpRateLimit(faits, args, DEFAULT_OTP_LIMITS),
    );
  });
});
