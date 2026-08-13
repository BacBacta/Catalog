import { describe, expect, it } from "vitest";
import { lireEntreesBot } from "../domain/bot/entrees.ts";
import {
  ALPHABET_DEFI,
  composerCodeDefi,
  construireLienWa,
  DUREE_DEFI_S,
  decisionEchange,
  extraireCodeDefi,
  lireMessagesEntrants,
  texteMessageDefi,
} from "../domain/connexion-whatsapp.ts";

/**
 * Regles pures du defi WhatsApp — ADR 0027.
 *
 * Pas d'horloge implicite : chaque cas passe son `maintenant`. C'est ce qui
 * permet de tester l'expiration a la seconde pres.
 */

describe("composerCodeDefi", () => {
  it("produit AAAA-BB sur l'alphabet reduit", () => {
    const code = composerCodeDefi(new Uint8Array([0, 31, 64, 255, 7, 199]));
    expect(code).toMatch(new RegExp(`^[${ALPHABET_DEFI}]{4}-[${ALPHABET_DEFI}]{2}$`));
  });

  it("est deterministe : meme aleatoire, meme code", () => {
    const octets = new Uint8Array([12, 34, 56, 78, 90, 123]);
    expect(composerCodeDefi(octets)).toBe(composerCodeDefi(octets));
  });

  it("ne produit jamais les caracteres ambigus", () => {
    // Tous les octets possibles : aucun ne doit sortir 0, O, 1, I, L ou U.
    const tous = composerCodeDefi(new Uint8Array(Array.from({ length: 6 }, (_, i) => i)));
    for (const ambigu of ["0", "O", "1", "I", "L", "U"]) {
      expect(ALPHABET_DEFI).not.toContain(ambigu);
    }
    expect(tous).toHaveLength(7);
  });

  it("refuse moins de six octets", () => {
    expect(() => composerCodeDefi(new Uint8Array([1, 2, 3]))).toThrow(/six octets/);
  });
});

describe("extraireCodeDefi", () => {
  it("retrouve le code dans le message pre-rempli intact", () => {
    expect(extraireCodeDefi(texteMessageDefi("7F3K-2M"))).toBe("7F3K-2M");
  });

  it("tolere la casse et le texte autour", () => {
    expect(extraireCodeDefi("bonjour, connexion catalog : 7f3k-2m merci")).toBe("7F3K-2M");
  });

  it("retrouve un code retape seul", () => {
    expect(extraireCodeDefi("7F3K-2M")).toBe("7F3K-2M");
  });

  it("ne ramasse rien dans du texte ordinaire", () => {
    expect(extraireCodeDefi("je passe demain vers 15h, ok ?")).toBeNull();
    expect(extraireCodeDefi("")).toBeNull();
  });

  it("ignore un pseudo-code sur le mauvais alphabet", () => {
    // O, I et L sont exclus de l'alphabet : OOOO-II n'est pas un defi.
    expect(extraireCodeDefi("OOOO-II")).toBeNull();
  });
});

describe("construireLienWa", () => {
  it("vise wa.me avec le numero en chiffres seuls", () => {
    const lien = construireLienWa("+237 6 90 00 00 00", "7F3K-2M");
    expect(lien).toMatch(/^https:\/\/wa\.me\/237690000000\?text=/);
  });

  it("encode le texte, code compris", () => {
    const lien = construireLienWa("237690000000", "7F3K-2M");
    expect(lien).toContain(encodeURIComponent("7F3K-2M"));
    // Aucun espace nu : tout est encode.
    expect(lien).not.toContain(" ");
  });

  it("le message se defend seul contre le relais social", () => {
    const texte = texteMessageDefi("7F3K-2M");
    expect(texte).toContain("7F3K-2M");
    expect(texte).toContain("ne l'envoyez pas");
  });
});

describe("lireMessagesEntrants", () => {
  /** La forme reelle d'une livraison Cloud API, reduite a ce qui nous sert. */
  const livraison = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "123",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              messages: [
                {
                  from: "237683921934",
                  id: "wamid.abc",
                  type: "text",
                  text: { body: "Connexion Catalog : 7F3K-2M." },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it("extrait l'expediteur et le texte", () => {
    expect(lireMessagesEntrants(livraison)).toEqual([
      { de: "237683921934", texte: "Connexion Catalog : 7F3K-2M." },
    ]);
  });

  it("ignore les livraisons de statut", () => {
    const statuts = {
      entry: [{ changes: [{ value: { statuses: [{ status: "delivered" }] } }] }],
    };
    expect(lireMessagesEntrants(statuts)).toEqual([]);
  });

  it("ignore les messages non textuels", () => {
    const image = {
      entry: [
        {
          changes: [{ value: { messages: [{ from: "237683921934", type: "image", image: {} }] } }],
        },
      ],
    };
    expect(lireMessagesEntrants(image)).toEqual([]);
  });

  it("ne leve jamais sur du JSON inattendu", () => {
    for (const corps of [null, 42, "texte", {}, { entry: "pas un tableau" }, { entry: [{}] }]) {
      expect(lireMessagesEntrants(corps)).toEqual([]);
    }
  });

  /**
   * La forme PLATE — ADR 0081. Le bac a sable 360dialog livre `messages[]` a
   * la racine ; le bot la lisait depuis le 02/08/2026, la connexion non. Sur
   * ce transport, le bot repondait et la connexion restait muette : le defaut
   * du 13/08, et il ne se voyait nulle part.
   */
  it("lit aussi la forme plate v1, sans enveloppe", () => {
    const plate = {
      contacts: [{ profile: { name: "Vendeuse" }, wa_id: "32466457281" }],
      messages: [
        {
          from: "32466457281",
          id: "ABGGh0",
          type: "text",
          text: { body: "Connexion Catalog : 7F3K-2M." },
        },
      ],
    };
    expect(lireMessagesEntrants(plate)).toEqual([
      { de: "32466457281", texte: "Connexion Catalog : 7F3K-2M." },
    ]);
  });
});

/**
 * Le garde-fou qui vaut plus que les deux corrections : les DEUX parseurs du
 * meme webhook doivent voir les MEMES messages. Ils lisent des choses
 * differentes — le bot comprend les boutons et les photos, la connexion ne
 * veut que le texte —, mais aucune enveloppe ne doit exister pour l'un et pas
 * pour l'autre. C'est leur desaccord qui a coute la connexion du 13/08, pas
 * l'un des deux pris isolement.
 */
describe("les deux parseurs du webhook s'accordent sur les enveloppes", () => {
  const message = {
    from: "32466457281",
    id: "wamid.abc",
    type: "text",
    text: { body: "Connexion Catalog : 7F3K-2M." },
  };

  const enveloppes: Record<string, unknown> = {
    "Cloud API": { entry: [{ changes: [{ field: "messages", value: { messages: [message] } }] }] },
    "plate v1": { messages: [message] },
  };

  for (const [nom, corps] of Object.entries(enveloppes)) {
    it(`voit le meme texte dans l'enveloppe ${nom}`, () => {
      const parDefi = lireMessagesEntrants(corps);
      const parBot = lireEntreesBot(corps).filter((e) => e.genre === "texte");
      expect(parDefi).toEqual([{ de: message.from, texte: message.text.body }]);
      expect(parBot.map((e) => ({ de: e.de, texte: e.texte }))).toEqual(parDefi);
    });
  }
});

describe("decisionEchange", () => {
  const maintenant = new Date("2026-08-01T10:00:00Z");
  const expireA = new Date(maintenant.getTime() + DUREE_DEFI_S * 1000);

  it("un defi en attente reste en attente", () => {
    expect(decisionEchange({ valeur: { statut: "en_attente" }, expireA }, maintenant)).toEqual({
      decision: "en_attente",
    });
  });

  it("un defi verifie livre le numero", () => {
    expect(
      decisionEchange(
        { valeur: { statut: "verifie", numero: "+237683921934" }, expireA },
        maintenant,
      ),
    ).toEqual({ decision: "verifie", numero: "+237683921934" });
  });

  it("un defi expire est inconnu — a la seconde pres", () => {
    const record = { valeur: { statut: "verifie" as const, numero: "+237683921934" }, expireA };
    expect(decisionEchange(record, new Date(expireA.getTime() - 1)).decision).toBe("verifie");
    expect(decisionEchange(record, expireA).decision).toBe("inconnu");
  });

  it("un defi absent est inconnu, pas une erreur", () => {
    expect(decisionEchange(null, maintenant)).toEqual({ decision: "inconnu" });
  });

  it("un defi verifie SANS numero reste en attente — jamais de session sans numero", () => {
    expect(decisionEchange({ valeur: { statut: "verifie" }, expireA }, maintenant).decision).toBe(
      "en_attente",
    );
  });
});
