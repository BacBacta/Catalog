import { describe, expect, it } from "vitest";
import { type Langue, type SmsMessage, texteSms } from "../domain/sms-sender.ts";

/**
 * Les textes des SMS sortants, dans les trois langues.
 *
 * **Pourquoi ce test existe.** La mesure de couverture a montre que seules deux
 * des douze variantes etaient exercees : le francais de `otp_connexion` et celui
 * de `otp_reversement`. Les dix autres ne sont jamais executees, donc une variante
 * a laquelle il manquerait le code — un `${c}` oublie — partirait chez une
 * vendeuse sans que rien ne le voie. Un SMS d'OTP sans code est une vendeuse
 * enfermee dehors.
 *
 * AGENTS.md prevoit les variantes anglais et pidgin **des la conception** : les
 * operateurs ecrivent aussi en anglais, et le pidgin n'est pas reserve aux
 * regions anglophones.
 */

const KINDS: SmsMessage["kind"][] = [
  "otp_connexion",
  "otp_reversement",
  "rappel_solde",
  "expiration",
];
const LANGUES: Langue[] = ["fr", "en", "pcm"];

describe("texteSms", () => {
  it("les douze variantes existent et portent la valeur", () => {
    // La valeur est un code d'OTP, un montant ou une reference selon le message :
    // dans les trois cas elle doit apparaitre, sinon le message ne sert a rien.
    for (const kind of KINDS) {
      for (const langue of LANGUES) {
        const texte = texteSms(kind, "483920", langue);
        expect(texte, `${kind}/${langue}`).toContain("483920");
        expect(texte.length, `${kind}/${langue}`).toBeGreaterThan(20);
      }
    }
  });

  it("le francais est la langue par defaut", () => {
    expect(texteSms("otp_connexion", "483920")).toBe(texteSms("otp_connexion", "483920", "fr"));
  });

  it("chaque message nomme Catalog", () => {
    // Un SMS sans expediteur identifiable ressemble a une tentative d'hameconnage,
    // et c'est exactement ce qu'une vendeuse prudente ignorera.
    for (const kind of KINDS) {
      for (const langue of LANGUES) {
        expect(texteSms(kind, "483920", langue), `${kind}/${langue}`).toContain("Catalog");
      }
    }
  });

  it("les deux messages d'OTP annoncent une duree", () => {
    for (const langue of LANGUES) {
      const texte = texteSms("otp_connexion", "483920", langue);
      expect(texte, langue).toMatch(/5|five/i);
    }
  });

  it("le message de reversement dit bien qu'il s'agit du numero de PAIEMENT", () => {
    // C'est le champ qu'un attaquant chercherait a detourner : le SMS doit
    // permettre a la vendeuse de comprendre ce qu'elle confirme, meme si elle n'a
    // rien demande.
    expect(texteSms("otp_reversement", "483920", "fr")).toMatch(/pay/i);
    expect(texteSms("otp_reversement", "483920", "en")).toMatch(/paid|pay/i);
    expect(texteSms("otp_reversement", "483920", "pcm")).toMatch(/money|collect/i);
  });

  it("aucune variante ne laisse un gabarit non substitue", () => {
    for (const kind of KINDS) {
      for (const langue of LANGUES) {
        const texte = texteSms(kind, "483920", langue);
        expect(texte, `${kind}/${langue}`).not.toContain("${");
        expect(texte, `${kind}/${langue}`).not.toContain("undefined");
      }
    }
  });

  it("les trois langues d'un meme message sont DISTINCTES", () => {
    // Un copier-coller qui laisserait le francais dans la case anglaise passerait
    // tous les tests precedents.
    for (const kind of KINDS) {
      const textes = LANGUES.map((l) => texteSms(kind, "483920", l));
      expect(new Set(textes).size, kind).toBe(LANGUES.length);
    }
  });
});
