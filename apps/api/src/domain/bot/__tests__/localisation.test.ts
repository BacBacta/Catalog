import { describe, expect, it } from "vitest";
import { reagirAcheteuse } from "../conversation.ts";
import { lireEntreesBot } from "../entrees.ts";
import { demandeLocalisation } from "../messages.ts";

/**
 * La localisation — sprint « le bot devient une application ».
 *
 * Elle ne remplace RIEN : l'ADR 0005 est formel, il n'existe pas d'adresse au
 * Cameroun, et le quartier + le repere + le telephone restent obligatoires.
 * Le point est un confort pour le livreur, jamais une saisie de plus.
 */

function paquet(message: unknown) {
  return {
    entry: [{ changes: [{ value: { messages: [message] } }] }],
  };
}

describe("lire une localisation entrante", () => {
  it("rend une entree « localisation » portant les deux coordonnees", () => {
    const entrees = lireEntreesBot(
      paquet({
        from: "237690112233",
        id: "wamid.LOC1",
        type: "location",
        location: { latitude: 4.0511, longitude: 9.7679 },
      }),
    );
    expect(entrees).toEqual([
      {
        de: "237690112233",
        genre: "localisation",
        lat: 4.0511,
        lng: 9.7679,
        messageId: "wamid.LOC1",
      },
    ]);
  });

  it("NE retient ni le nom ni l'adresse que Meta joint parfois — ADR 0005", () => {
    const [e] = lireEntreesBot(
      paquet({
        from: "237690112233",
        id: "wamid.LOC2",
        type: "location",
        location: {
          latitude: 4.0511,
          longitude: 9.7679,
          name: "Pharmacie du Rond-Point",
          address: "12 rue de la Joie, Bonapriso, Douala",
        },
      }),
    );
    expect(JSON.stringify(e)).not.toContain("rue");
    expect(JSON.stringify(e)).not.toContain("Pharmacie");
    expect(e).not.toHaveProperty("address");
    expect(e).not.toHaveProperty("nom");
  });

  it("ignore une localisation sans coordonnees exploitables plutot que d'inventer un zero", () => {
    const entrees = lireEntreesBot(
      paquet({ from: "237690112233", id: "wamid.LOC3", type: "location", location: {} }),
    );
    /* Zero degre de latitude est un point REEL (golfe de Guinee, a 300 km de
       Douala). Une coordonnee absente ne doit donc jamais devenir un 0. */
    expect(entrees[0]).toMatchObject({ genre: "autre", forme: "localisation" });
  });
});

describe("demander une localisation", () => {
  it("construit le message natif que Meta attend", () => {
    expect(demandeLocalisation("237690112233", "Votre position ?")).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "237690112233",
      type: "interactive",
      interactive: {
        type: "location_request_message",
        body: { text: "Votre position ?" },
        action: { name: "send_location" },
      },
    });
  });

  it("refuse un corps vide : un bouton sans phrase ne se comprend pas", () => {
    expect(() => demandeLocalisation("237690112233", "   ")).toThrow();
  });
});

/* ────────────────────────────────────────────────────────────────────────
   Le parcours : la position s'AJOUTE, elle ne remplace aucun champ
   obligatoire — ADR 0005, il n'existe pas d'adresse au Cameroun.
   ──────────────────────────────────────────────────────────────────────── */

const VERS = "237690112233";
const BOUTIQUE = {
  slug: "chez-amina",
  nom: "Chez Amina",
  ville: "Douala",
  whatsappVendeuse: "+237690000001",
  articles: [{ id: "a1", nom: "Robe wax", prixXaf: 15000, stock: null }],
} as never;
const PANIER = [{ articleId: "a1", quantite: 1 }];

function estDemandePosition(m: unknown): boolean {
  return (
    (m as { interactive?: { type?: string } })?.interactive?.type === "location_request_message"
  );
}

/** L'etat juste avant la saisie des details, en livraison. */
const VILLE_CHOISIE = { nom: "ville", slug: "chez-amina", panier: PANIER } as never;
/** Le meme, en retrait : le mode se choisit avant la ville. */
const MODE = { nom: "mode", slug: "chez-amina", panier: PANIER } as never;

describe("demander la position au bon moment", () => {
  it("l'entree en saisie de livraison porte la demande de position, EN PLUS de la question", () => {
    const r = reagirAcheteuse(
      VILLE_CHOISIE,
      { genre: "texte", texte: "Douala" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
      },
    );
    expect(r.messages.some(estDemandePosition)).toBe(true);
    /* La question garde ses sorties de secours : `location_request_message`
       n'accepte qu'une action, donc il ne peut PAS porter « annuler ». */
    const question = r.messages.find((m) => !estDemandePosition(m));
    expect(JSON.stringify(question)).toContain("annuler");
  });

  it("le RETRAIT n'en demande pas : le point de rendez-vous est celui de la vendeuse", () => {
    const r = reagirAcheteuse(
      MODE,
      { genre: "bouton", id: "mode:retrait" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
      },
    );
    expect(r.messages.some(estDemandePosition)).toBe(false);
  });
});

describe("recevoir la position", () => {
  const enSaisie = () =>
    reagirAcheteuse(
      VILLE_CHOISIE,
      { genre: "texte", texte: "Douala" },
      {
        vers: VERS,
        boutique: BOUTIQUE,
      },
    ).etat;

  it("un point NE suffit pas : le quartier, le repere et le telephone restent exiges", () => {
    const r = reagirAcheteuse(
      enSaisie(),
      { genre: "localisation", lat: 4.05, lng: 9.76 },
      {
        vers: VERS,
        boutique: BOUTIQUE,
      },
    );
    /* On reste en saisie : aucune commande, aucun recapitulatif. */
    expect((r.etat as { nom: string }).nom).toBe("details");
    expect(r.effet).toBeUndefined();
  });

  it("le point recu se retrouve dans la livraison une fois les champs donnes", () => {
    const apresPoint = reagirAcheteuse(
      enSaisie(),
      { genre: "localisation", lat: 4.05, lng: 9.76 },
      { vers: VERS, boutique: BOUTIQUE },
    ).etat;
    const r = reagirAcheteuse(
      apresPoint,
      { genre: "texte", texte: "Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33" },
      { vers: VERS, boutique: BOUTIQUE },
    );
    const etat = r.etat as { nom: string; livraison?: { geo?: { lat: number; lng: number } } };
    expect(etat.nom).toBe("recap");
    expect(etat.livraison?.geo).toEqual({ lat: 4.05, lng: 9.76 });
  });

  it("sans point, la livraison n'a PAS de champ geo — l'absence reste une absence", () => {
    const r = reagirAcheteuse(
      enSaisie(),
      { genre: "texte", texte: "Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33" },
      { vers: VERS, boutique: BOUTIQUE },
    );
    const etat = r.etat as { livraison?: Record<string, unknown> };
    expect(etat.livraison).not.toHaveProperty("geo");
  });

  it("un point envoye APRES le recapitulatif s'y attache, sans rien casser", () => {
    const recap = reagirAcheteuse(
      enSaisie(),
      { genre: "texte", texte: "Bonapriso, en face de la pharmacie du Rond-Point, 690 11 22 33" },
      { vers: VERS, boutique: BOUTIQUE },
    ).etat;
    const r = reagirAcheteuse(
      recap,
      { genre: "localisation", lat: 4.05, lng: 9.76 },
      {
        vers: VERS,
        boutique: BOUTIQUE,
      },
    );
    const etat = r.etat as { nom: string; livraison?: { geo?: unknown } };
    expect(etat.nom).toBe("recap");
    expect(etat.livraison?.geo).toEqual({ lat: 4.05, lng: 9.76 });
    /* Et le recapitulatif se re-montre : elle doit revoir avant de confirmer. */
    expect(r.messages.length).toBeGreaterThan(0);
  });
});

describe("l'aiguillage laisse passer la position", () => {
  it("une VENDEUSE en train d'acheter garde son achat quand elle envoie sa position", async () => {
    /* Une vendeuse qui commande ailleurs est un cas normal (ADR 0052) : sa
       position ne doit pas la renvoyer dans son fil vendeuse au milieu d'une
       saisie de livraison. */
    const { aiguiller } = await import("../aiguillage.ts");
    expect(
      aiguiller(
        { genre: "localisation" },
        { estVendeuse: true, etatVendeuseEnCours: false, smsReconnu: false, achatEnCours: true },
      ),
    ).toBe("acheteuse");
  });
});

/* ────────────────────────────────────────────────────────────────────────
   Le formulaire et la position se composent — par une CASE, pas par un
   champ de carte : Meta n'en a pas (mesure du 11/08/2026, ADR 0063).
   ──────────────────────────────────────────────────────────────────────── */

describe("le formulaire demande la position par une case a cocher", () => {
  const rempli = (position?: boolean | string) =>
    JSON.stringify({
      flow_token: "livraison:chez-amina",
      ville: "Douala",
      quartier: "Bonapriso",
      repere: "en face de la pharmacie du Rond-Point",
      telephone: "690112233",
      ...(position === undefined ? {} : { position }),
    });

  it("lit la case, qu'elle arrive en booleen ou en chaine", async () => {
    const { veutPositionFlux } = await import("../flux.ts");
    expect(veutPositionFlux(rempli(true))).toBe(true);
    expect(veutPositionFlux(rempli("true"))).toBe(true);
    expect(veutPositionFlux(rempli(false))).toBe(false);
    expect(veutPositionFlux(rempli("false"))).toBe(false);
  });

  it("case absente = pas de demande — on n'insiste jamais tout seul", async () => {
    const { veutPositionFlux } = await import("../flux.ts");
    expect(veutPositionFlux(rempli(undefined))).toBe(false);
    expect(veutPositionFlux("pas du json")).toBe(false);
  });

  it("cochee : la demande de position suit le recapitulatif", async () => {
    const { reagirAcheteuse } = await import("../conversation.ts");
    const r = reagirAcheteuse(
      { nom: "ville", slug: "chez-amina", panier: [{ articleId: "a1", quantite: 1 }] } as never,
      { genre: "flux", reponse: rempli(true) },
      { vers: VERS, boutique: BOUTIQUE } as never,
    );
    expect((r.etat as { nom: string }).nom).toBe("recap");
    expect(r.messages.some(estDemandePosition)).toBe(true);
    /* Le recapitulatif reste EN PREMIER : elle lit ce qu'elle a saisi avant
       qu'on lui demande autre chose. */
    expect(estDemandePosition(r.messages[0])).toBe(false);
  });

  it("non cochee : le recapitulatif seul, comme avant", async () => {
    const { reagirAcheteuse } = await import("../conversation.ts");
    const r = reagirAcheteuse(
      { nom: "ville", slug: "chez-amina", panier: [{ articleId: "a1", quantite: 1 }] } as never,
      { genre: "flux", reponse: rempli(false) },
      { vers: VERS, boutique: BOUTIQUE } as never,
    );
    expect(r.messages.some(estDemandePosition)).toBe(false);
  });

  it("la case ne salit PAS la livraison enregistree", async () => {
    /* `position` est une intention, pas une donnee de livraison : elle ne doit
       pas se retrouver en base a cote du quartier et du repere. */
    const { reagirAcheteuse } = await import("../conversation.ts");
    const r = reagirAcheteuse(
      { nom: "ville", slug: "chez-amina", panier: [{ articleId: "a1", quantite: 1 }] } as never,
      { genre: "flux", reponse: rempli(true) },
      { vers: VERS, boutique: BOUTIQUE } as never,
    );
    expect((r.etat as { livraison: Record<string, unknown> }).livraison).not.toHaveProperty(
      "position",
    );
  });
});
