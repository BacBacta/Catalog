import { describe, expect, it } from "vitest";
import { lireEntreesBot } from "../entrees.ts";
import { CHAMPS_FLUX, lireReponseFlux, messageFlux } from "../flux.ts";
import type { MessageFlux } from "../messages.ts";

/**
 * Le Flow de livraison — ADR 0055.
 *
 * ⚠️ NON VERIFIE CONTRE UN VRAI FLOW. L'API de notre cle n'expose que les
 * gabarits et la configuration de reception (mesure le 08/08/2026) : un Flow ne peut
 * cree ni etre teste depuis le depot. Ce que ces tests garantissent, c'est le
 * DOMAINE : la forme du message sortant, et la lecture d'une reponse. La
 * jonction avec un Flow reel reste a confirmer sur un telephone.
 */

const VERS = "237690112233";

/** Une reponse de Flow telle que Meta la livre. */
const livraisonFlux = (donnees: Record<string, unknown>) => ({
  messages: [
    {
      from: VERS,
      id: "wamid.1",
      type: "interactive",
      interactive: {
        type: "nfm_reply",
        nfm_reply: { name: "flow", response_json: JSON.stringify(donnees) },
      },
    },
  ],
});

describe("le parseur reconnait une reponse de Flow", () => {
  it("elle ne tombe plus dans « forme non lue »", () => {
    const lues = lireEntreesBot(livraisonFlux({ quartier: "Bonapriso" }));
    expect(lues).toHaveLength(1);
    expect(lues[0]).toMatchObject({ genre: "flux", messageId: "wamid.1" });
  });

  it("le contenu voyage BRUT — le domaine le lit, pas le parseur", () => {
    const lues = lireEntreesBot(livraisonFlux({ quartier: "Bonapriso" }));
    expect((lues[0] as { reponse: string }).reponse).toBe('{"quartier":"Bonapriso"}');
  });

  it("une reponse illisible ne leve pas — elle devient une forme non lue", () => {
    const brut = {
      messages: [
        {
          from: VERS,
          id: "w1",
          type: "interactive",
          interactive: { type: "nfm_reply", nfm_reply: { response_json: 42 } },
        },
      ],
    };
    expect(lireEntreesBot(brut)[0]).toMatchObject({ genre: "autre", forme: "inconnue" });
  });
});

describe("la lecture d'une reponse de livraison", () => {
  const COMPLET = {
    [CHAMPS_FLUX.ville]: "Bafoussam",
    [CHAMPS_FLUX.quartier]: "Banengo",
    [CHAMPS_FLUX.repere]: "en face du marché A",
    [CHAMPS_FLUX.telephone]: "690 11 22 33",
  };

  it("rend une livraison conforme au schema du produit", () => {
    const lu = lireReponseFlux(JSON.stringify(COMPLET));
    expect(lu).toEqual({
      mode: "livraison",
      city: "Bafoussam",
      quartier: "Banengo",
      landmark: "en face du marché A",
      phone: "+237690112233",
    });
  });

  it("accepte le numero sous toutes ses ecritures — comme la saisie libre", () => {
    for (const tel of [
      "690112233",
      "690 11 22 33",
      "6 90 11 22 33",
      "+237690112233",
      "00237690112233",
    ]) {
      const lu = lireReponseFlux(JSON.stringify({ ...COMPLET, [CHAMPS_FLUX.telephone]: tel }));
      expect(lu?.phone, tel).toBe("+237690112233");
    }
  });

  it("un champ OBLIGATOIRE manquant rend null — on ne fabrique pas de livraison", () => {
    /* Repere et telephone sont obligatoires (AGENTS.md §2 : il n'existe pas
       d'adresse au Cameroun, le repere est ce qui la remplace). */
    for (const absent of [
      CHAMPS_FLUX.ville,
      CHAMPS_FLUX.quartier,
      CHAMPS_FLUX.repere,
      CHAMPS_FLUX.telephone,
    ]) {
      const partiel = { ...COMPLET };
      delete (partiel as Record<string, unknown>)[absent];
      expect(lireReponseFlux(JSON.stringify(partiel)), absent).toBeNull();
    }
  });

  it("un JSON casse rend null au lieu de lever", () => {
    for (const brut of ["", "{", "null", "[]", '"texte"']) {
      expect(lireReponseFlux(brut), brut).toBeNull();
    }
  });

  it("un numero non camerounais est refuse, pas maquille", () => {
    const lu = lireReponseFlux(
      JSON.stringify({ ...COMPLET, [CHAMPS_FLUX.telephone]: "+33612345678" }),
    );
    expect(lu).toBeNull();
  });

  it("aucun champ « adresse » n'existe — AGENTS.md §2", () => {
    expect(Object.values(CHAMPS_FLUX).join(" ")).not.toMatch(/adresse|address/i);
  });
});

describe("le message qui OUVRE le Flow", () => {
  it("porte l'identifiant du Flow et un jeton de session", () => {
    const m = messageFlux(VERS, "1234567890", "Livraison", "jeton-abc") as MessageFlux;
    expect(m.type).toBe("interactive");
    expect(m.interactive.type).toBe("flow");
    expect(m.interactive.action.parameters.flow_id).toBe("1234567890");
    expect(m.interactive.action.parameters.flow_token).toBe("jeton-abc");
  });

  it("le jeton n'est JAMAIS le jeton acheteuse — il ne sort pas du fil", () => {
    /* `buyerToken` autorise la contre-signature (ADR 0021) : il ne voyage pas
       dans un message que WhatsApp renverra. Le jeton de flux est jetable. */
    const m = messageFlux(VERS, "1", "Livraison", "jeton-abc") as MessageFlux;
    expect(JSON.stringify(m)).not.toContain("buyerToken");
  });
});
