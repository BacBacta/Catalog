import { describe, expect, it } from "vitest";
import { aiguiller } from "../aiguillage.ts";
import { reagirAcheteuse } from "../conversation.ts";
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

/**
 * L'envoi du Flow s'AJOUTE, il ne remplace jamais — ADR 0055.
 *
 * Un Flow exige un WhatsApp recent. Sur un Android bas de gamme a Douala, il
 * ne s'affiche pas — et l'acheteuse doit quand meme pouvoir commander. Les
 * deux partent donc dans le meme fil : le formulaire pour celles qui peuvent
 * l'ouvrir, la question pour toutes les autres.
 */
describe("le Flow s'ajoute a la question, il ne la remplace pas", () => {
  const BOUTIQUE = {
    slug: "chez-amina",
    nom: "Chez Amina",
    ville: "Douala",
    whatsappVendeuse: "+237690000001",
    articles: [{ id: "a1", nom: "Robe wax", prixXaf: 15000, stock: null }],
  } as never;
  const ETAT = {
    nom: "mode",
    slug: "chez-amina",
    panier: [{ articleId: "a1", quantite: 1 }],
  } as never;

  it("SANS identifiant de Flow : le fil est exactement celui d'avant", () => {
    const r = reagirAcheteuse(
      ETAT,
      { genre: "bouton", id: "mode:livraison" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
      },
    );
    expect(r.messages).toHaveLength(1);
    expect(
      r.messages.some(
        (m) =>
          (m as { type?: string }).type === "interactive" &&
          (m as { interactive?: { type?: string } }).interactive?.type === "flow",
      ),
    ).toBe(false);
  });

  it("AVEC identifiant : le formulaire part EN PLUS de la question", () => {
    const r = reagirAcheteuse(
      ETAT,
      { genre: "bouton", id: "mode:livraison" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
        fluxLivraisonId: "1234567890",
      },
    );
    const formes = r.messages.map(
      (m) => (m as { interactive?: { type?: string } }).interactive?.type,
    );
    expect(formes).toContain("flow");
    expect(formes).toContain("button");
  });

  it("la question passe EN DERNIER — c'est elle qui reste visible si le Flow echoue", () => {
    const r = reagirAcheteuse(
      ETAT,
      { genre: "bouton", id: "mode:livraison" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
        fluxLivraisonId: "1234567890",
      },
    );
    const dernier = r.messages[r.messages.length - 1] as { interactive?: { type?: string } };
    expect(dernier.interactive?.type).toBe("button");
  });

  it("l'etat ne change pas : le Flow n'est qu'un raccourci vers la meme etape", () => {
    const sans = reagirAcheteuse(
      ETAT,
      { genre: "bouton", id: "mode:livraison" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
      },
    );
    const avec = reagirAcheteuse(
      ETAT,
      { genre: "bouton", id: "mode:livraison" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
        fluxLivraisonId: "1234567890",
      },
    );
    expect(avec.etat).toEqual(sans.etat);
  });

  it("une reponse de Flow mene au recapitulatif, comme la saisie libre", () => {
    const enVille = {
      nom: "ville",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 1 }],
    } as never;
    const r = reagirAcheteuse(
      enVille,
      {
        genre: "flux",
        reponse: JSON.stringify({
          [CHAMPS_FLUX.ville]: "Bafoussam",
          [CHAMPS_FLUX.quartier]: "Banengo",
          [CHAMPS_FLUX.repere]: "en face du marché A",
          [CHAMPS_FLUX.telephone]: "690 11 22 33",
        }),
      },
      { vers: VERS, boutique: BOUTIQUE },
    );
    const etat = r.etat as { nom: string; livraison?: { city?: string } };
    expect(etat.nom).toBe("recap");
    expect(etat.livraison?.city).toBe("Bafoussam");
  });

  it("une reponse de Flow ILLISIBLE re-pose la question, elle ne casse rien", () => {
    const enVille = {
      nom: "ville",
      slug: "chez-amina",
      panier: [{ articleId: "a1", quantite: 1 }],
    } as never;
    const r = reagirAcheteuse(
      enVille,
      { genre: "flux", reponse: "{cassé" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
      },
    );
    expect((r.etat as { nom: string }).nom).toBe("ville");
    expect(r.messages.length).toBeGreaterThan(0);
  });
});

/**
 * L'aiguillage d'une reponse de Flow — ADR 0055 avec 0052.
 *
 * Une vendeuse achete aussi (elle teste sa boutique, elle commande chez une
 * consoeur). Sa reponse de formulaire doit atteindre le fil ACHETEUSE, pas
 * son espace de vente : c'est le geste qui decide, jamais l'identite.
 */
describe("une reponse de Flow arrive au bon fil", () => {
  const AU_REPOS = {
    estVendeuse: false,
    etatVendeuseEnCours: false,
    smsReconnu: false,
    achatEnCours: false,
  };

  it("au milieu d'un achat, elle va a l'acheteuse — meme pour une vendeuse", () => {
    expect(
      aiguiller({ genre: "flux" }, { ...AU_REPOS, estVendeuse: true, achatEnCours: true }),
    ).toBe("acheteuse");
  });

  it("une inscription en cours la garde : la machine arbitre, pas l'aiguillage", () => {
    /* Elle y devient une forme non lue (ADR 0049) — une phrase, pas un
       silence — et le formulaire vendeuse n'est pas detruit. */
    expect(aiguiller({ genre: "flux" }, { ...AU_REPOS, etatVendeuseEnCours: true })).toBe(
      "inscription",
    );
  });
});
