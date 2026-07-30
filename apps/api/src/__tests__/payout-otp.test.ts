import { describe, expect, it } from "vitest";
import {
  DUREE_OTP_MS,
  ESSAIS_MAX,
  genererCodeOtp,
  type OtpEnregistre,
  verifierCodeOtp,
} from "../domain/payout-otp.ts";

/**
 * L'OTP du reversement, prouve sur la logique pure.
 *
 * Ce qui compte ici n'est pas qu'un bon code passe — c'est que les mauvais ne
 * passent pas, et dans le bon ordre. Un code expire mais juste doit etre refuse
 * POUR expiration : s'il ressortait « correct », la duree de vie ne serait
 * qu'une decoration.
 */

const NOW = new Date("2026-07-30T10:00:00+01:00");

function ligne(p: Partial<OtpEnregistre> = {}): OtpEnregistre {
  return {
    id: "otp-1",
    phone: "+237699000111",
    codeHash: "empreinte-de-123456",
    expiresAt: new Date(NOW.getTime() + DUREE_OTP_MS),
    consumedAt: null,
    attempts: 0,
    ...p,
  };
}

const empreinte = (code: string) => `empreinte-de-${code}`;
const comparer = (a: string, b: string) => a === b;
const saisie = (code: string, now = NOW) => ({ code, empreinte, now });

describe("genererCodeOtp", () => {
  it("rend six chiffres", () => {
    const octets = (n: number) => {
      const a = new Uint8Array(n);
      globalThis.crypto.getRandomValues(a);
      return a;
    };
    for (let i = 0; i < 200; i++) {
      expect(genererCodeOtp(octets)).toMatch(/^\d{6}$/);
    }
  });

  it("rejette le biais du modulo — 250 a 255 ne sortent jamais", () => {
    // Une source qui ne rend que 252 : sans rejet, 252 % 10 = 2 sortirait.
    // Avec rejet, la boucle doit chercher ailleurs. On lui donne ensuite des
    // octets utilisables pour qu'elle termine.
    let appels = 0;
    const source = (n: number) => new Uint8Array(n).fill(appels++ === 0 ? 252 : 7);
    expect(genererCodeOtp(source)).toBe("777777");
    expect(appels).toBeGreaterThan(1);
  });

  it("ne repete pas le meme code sur mille tirages", () => {
    const octets = (n: number) => {
      const a = new Uint8Array(n);
      globalThis.crypto.getRandomValues(a);
      return a;
    };
    const vus = new Set<string>();
    for (let i = 0; i < 1000; i++) vus.add(genererCodeOtp(octets));
    // Un million de possibilites, mille tirages : quelques collisions sont
    // normales, une poignee de valeurs distinctes serait un generateur casse.
    expect(vus.size).toBeGreaterThan(980);
  });
});

describe("verifierCodeOtp", () => {
  it("accepte le bon code et rend le numero verifie", () => {
    const v = verifierCodeOtp(ligne(), saisie("123456"), comparer);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.numero).toBe("+237699000111");
    expect(v.verifieA).toEqual(NOW);
  });

  it("refuse quand aucun code n'a ete demande", () => {
    const v = verifierCodeOtp(null, saisie("123456"), comparer);
    expect(v).toMatchObject({ ok: false, raison: "aucun_code_en_cours", bruler: false });
  });

  it("refuse un code EXPIRE, meme s'il est juste", () => {
    const apres = new Date(NOW.getTime() + DUREE_OTP_MS + 1000);
    const v = verifierCodeOtp(ligne(), saisie("123456", apres), comparer);
    // Le point du test : la raison est l'expiration, pas « incorrect ».
    expect(v).toMatchObject({ ok: false, raison: "code_expire", bruler: true });
  });

  it("refuse un code DEJA CONSOMME, meme s'il est juste", () => {
    const v = verifierCodeOtp(ligne({ consumedAt: NOW }), saisie("123456"), comparer);
    expect(v).toMatchObject({ ok: false, raison: "code_deja_utilise" });
  });

  it("refuse au-dela du nombre d'essais, meme si le code devient juste", () => {
    const v = verifierCodeOtp(ligne({ attempts: ESSAIS_MAX }), saisie("123456"), comparer);
    expect(v).toMatchObject({ ok: false, raison: "trop_d_essais", bruler: true });
  });

  it("refuse un mauvais code sans bruler la ligne avant le dernier essai", () => {
    const premier = verifierCodeOtp(ligne({ attempts: 0 }), saisie("000000"), comparer);
    expect(premier).toMatchObject({ ok: false, raison: "code_incorrect", bruler: false });

    const dernier = verifierCodeOtp(
      ligne({ attempts: ESSAIS_MAX - 1 }),
      saisie("000000"),
      comparer,
    );
    expect(dernier).toMatchObject({ ok: false, raison: "code_incorrect", bruler: true });
  });

  it("passe TOUJOURS par la fonction de comparaison injectee", () => {
    // Garde-fou : si un jour quelqu'un remplace l'appel par un `===`, la
    // comparaison en temps constant disparaitrait sans qu'aucun test ne bouge.
    let appelee = false;
    verifierCodeOtp(ligne(), saisie("123456"), (a, b) => {
      appelee = true;
      return a === b;
    });
    expect(appelee).toBe(true);
  });
});
