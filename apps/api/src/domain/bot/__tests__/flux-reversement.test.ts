import { describe, expect, it } from "vitest";
import { genreDuJeton, invitationReversement, jetonFlux, lireReversementFlux } from "../flux.ts";
import {
  type EtatVendeuse,
  lireCodeOtpColle,
  normaliserEtatVendeuse,
  questionDeLEtat,
  reagirInscription,
} from "../inscription.ts";

/**
 * Le reversement dans le fil — ADR 0097 (lot P3).
 *
 * Le domaine seul : la lecture de la reponse du formulaire, la lecture du
 * code colle, et l'etat d'attente. La verification elle-meme (OTP, service
 * `changerNumeroDeReversement`) vit au service et se prouve contre une vraie
 * base dans `bot-reversement.test.ts`.
 */

const reponse = (champs: Record<string, unknown>): string =>
  JSON.stringify({ flow_token: jetonFlux("reversement"), ...champs });

describe("lireReversementFlux — le lecteur", () => {
  it("lit une reponse complete : numero brut et operateur declare", () => {
    const lu = lireReversementFlux(reponse({ numero: "6 99 88 77 12", operateur: "orange" }));
    expect(lu).toEqual({ numeroBrut: "6 99 88 77 12", operateur: "orange" });
  });

  it("le jeton designe bien le genre « reversement »", () => {
    expect(genreDuJeton(reponse({ numero: "699887712", operateur: "mtn" }))).toBe("reversement");
  });

  it("refuse une reponse malformee — JSON casse, champ manquant, operateur inconnu", () => {
    expect(lireReversementFlux("pas du json")).toBeNull();
    expect(lireReversementFlux(reponse({ operateur: "orange" }))).toBeNull();
    expect(lireReversementFlux(reponse({ numero: "699887712" }))).toBeNull();
    /* Un identifiant hors produit arriverait illisible plus loin : refuse ICI,
       et le formulaire se re-propose au lieu d'echouer en silence. */
    expect(lireReversementFlux(reponse({ numero: "699887712", operateur: "camtel" }))).toBeNull();
  });

  it("refuse ce qui ne ressemble pas a un numero — trop court, ou un texte colle", () => {
    expect(lireReversementFlux(reponse({ numero: "12345", operateur: "mtn" }))).toBeNull();
    expect(
      lireReversementFlux(
        reponse({ numero: "appelez-moi au 699887712 svp merci", operateur: "mtn" }),
      ),
    ).toBeNull();
  });

  it("la VALIDITE du numero n'est pas tranchee ici — elle appartient au service", () => {
    /* Un numero a neuf chiffres qui n'est pas camerounais passe le lecteur :
       c'est `normalizePhone ?? numeroDuBanc` qui refuse, avec la meme phrase
       que la route — et le banc d'essai (ADR 0058) garde ainsi son chemin. */
    expect(lireReversementFlux(reponse({ numero: "324664572", operateur: "mtn" }))).not.toBeNull();
  });
});

describe("invitationReversement — la carte de la maquette", () => {
  it("porte la copie validee et ouvre le formulaire", () => {
    const m = invitationReversement("237699000001", "1234567890");
    expect(m.interactive.body.text).toContain("Un dernier réglage");
    expect(m.interactive.body.text).toContain("c'est le champ qu'un fraudeur viserait");
    expect(m.interactive.action.parameters.flow_cta).toBe("💳 Être payée d'avance");
    expect(m.interactive.action.parameters.flow_id).toBe("1234567890");
    expect(m.interactive.action.parameters.flow_token).toBe(jetonFlux("reversement"));
  });
});

describe("lireCodeOtpColle — le code colle, sous ses trois formes", () => {
  it("le code seul", () => {
    expect(lireCodeOtpColle("482910")).toBe("482910");
  });

  it("le code espace, comme le clavier le propose", () => {
    expect(lireCodeOtpColle("4 8 2 9 1 0")).toBe("482910");
    expect(lireCodeOtpColle("482 910")).toBe("482910");
  });

  it("le SMS Catalog colle en entier — « collez-le tel quel » l'encourage", () => {
    expect(
      lireCodeOtpColle(
        "Catalog : code 482910 pour confirmer que c'est bien sur ce numero que vous voulez etre payee.",
      ),
    ).toBe("482910");
  });

  it("refuse ce qui n'est pas un code — trop court, trop long, ou ambigu", () => {
    expect(lireCodeOtpColle("12345")).toBeNull();
    expect(lireCodeOtpColle("1234567")).toBeNull();
    expect(lireCodeOtpColle("bonjour")).toBeNull();
    /* Deux groupes de six : on ne devine pas lequel est le code (§7.7). */
    expect(lireCodeOtpColle("482910 ou 123456 ?")).toBeNull();
  });
});

describe("l'etat reversement_code", () => {
  const etat: EtatVendeuse = {
    nom: "reversement_code",
    numero: "+237699887712",
    operateur: "orange",
  };

  it("se persiste et se relit ; un operateur inconnu ne se relit pas", () => {
    expect(normaliserEtatVendeuse(JSON.parse(JSON.stringify(etat)))).toEqual(etat);
    expect(
      normaliserEtatVendeuse({ nom: "reversement_code", numero: "+237699887712", operateur: "x" }),
    ).toBeNull();
    expect(normaliserEtatVendeuse({ nom: "reversement_code", operateur: "mtn" })).toBeNull();
  });

  it("sa question nomme le numero et dit que le collage marche (critere 3.3.8)", () => {
    const q = questionDeLEtat(etat, "237699000001") as { text: { body: string } };
    expect(q.text.body).toContain("699 88 77 12");
    expect(q.text.body).toContain("collage");
    expect(q.text.body).toContain("annuler");
  });

  it("un code colle devient l'effet — la machine ne verifie pas, le service verifie", () => {
    const r = reagirInscription(etat, { genre: "texte", texte: "4 8 2 9 1 0" }, "237699000001");
    expect(r.effet).toEqual({ type: "verifier_code_reversement", code: "482910" });
    /* L'etat RESTE : c'est le service qui le ferme ou le garde selon le
       verdict (incorrect : on recolle ; expire ou brule : nouveau code). */
    expect(r.etat).toEqual(etat);
  });

  it("un texte sans code re-pose la question, sans rien perdre", () => {
    const r = reagirInscription(etat, { genre: "texte", texte: "c'est bon ?" }, "237699000001");
    expect(r.effet).toBeUndefined();
    expect(r.etat).toEqual(etat);
    expect((r.messages[0] as { text: { body: string } }).text.body).toContain("6 chiffres");
  });

  it("une image ou un bouton perime re-pose la question", () => {
    const image = reagirInscription(
      etat,
      { genre: "image", mediaId: "M1", legende: "" },
      "237699000001",
    );
    expect(image.etat).toEqual(etat);
    expect(image.messages).toHaveLength(1);
    const bouton = reagirInscription(etat, { genre: "bouton", id: "publier" }, "237699000001");
    expect(bouton.etat).toEqual(etat);
  });

  it("« annuler » sort, comme partout", () => {
    const r = reagirInscription(etat, { genre: "texte", texte: "annuler" }, "237699000001");
    expect(r.etat).toBeNull();
  });
});
