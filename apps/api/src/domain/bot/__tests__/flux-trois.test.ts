import { describe, expect, it } from "vitest";
import {
  formePhotoFlux,
  genreDuJeton,
  jetonFlux,
  lireArticleFlux,
  lireAvisFlux,
  lireInscriptionFlux,
  lireOuvertureFlux,
  lireReponseFlux,
} from "../flux.ts";

/**
 * Quatre formulaires, un seul fil — le sprint « le bot devient une application »,
 * puis le formulaire d'article (tache #62).
 *
 * Une reponse de Flow arrive TOUJOURS par le meme chemin (`nfm_reply`) : rien
 * dans le message ne dit quel formulaire a repondu. C'est le `flow_token`,
 * choisi par nous a l'envoi et renvoye tel quel, qui porte cette information.
 */

const reponse = (o: Record<string, unknown>) => JSON.stringify(o);

describe("le jeton dit QUEL formulaire a repondu", () => {
  it("porte le genre, et la reference quand il y en a une", () => {
    expect(jetonFlux("livraison", "chez-ngo")).toBe("livraison:chez-ngo");
    expect(jetonFlux("inscription")).toBe("inscription:");
    expect(jetonFlux("avis")).toBe("avis:");
  });

  it("se relit depuis la reponse", () => {
    expect(genreDuJeton(reponse({ flow_token: "avis:", note: "5" }))).toBe("avis");
    expect(genreDuJeton(reponse({ flow_token: "inscription:", boutique: "Chez Amina" }))).toBe(
      "inscription",
    );
  });

  it("SANS jeton, c'est la livraison — le seul formulaire deploye avant eux", () => {
    /* Compatibilite : une reponse en vol au moment du deploiement, ou un Flow
       ancien encore publie, ne doit pas se perdre. */
    expect(genreDuJeton(reponse({ ville: "Douala" }))).toBe("livraison");
  });

  it("un genre inconnu ne devient JAMAIS un genre connu", () => {
    expect(genreDuJeton(reponse({ flow_token: "paiement:CT-1" }))).toBeNull();
    expect(genreDuJeton("pas du json")).toBeNull();
  });

  it("le jeton ne porte jamais de secret — ADR 0021", () => {
    /* `buyerToken` autorise la contre-signature : il ne voyage pas dans un
       message que WhatsApp nous renverra. */
    for (const j of [
      jetonFlux("livraison", "chez-ngo"),
      jetonFlux("avis"),
      jetonFlux("inscription"),
    ]) {
      expect(j).not.toMatch(/token|secret|[0-9a-f]{16}/i);
    }
  });
});

describe("lire l'inscription", () => {
  it("rend la boutique, la ville et la langue", () => {
    expect(
      lireInscriptionFlux(
        reponse({
          flow_token: "inscription:",
          boutique: " Chez Amina ",
          ville: "Douala",
          langue: "fr",
        }),
      ),
    ).toEqual({ nomBoutique: "Chez Amina", ville: "Douala", langue: "fr" });
  });

  it("une langue inconnue retombe sur le francais plutot que de casser l'inscription", () => {
    const lu = lireInscriptionFlux(
      reponse({ boutique: "Chez Amina", ville: "Douala", langue: "wolof" }),
    );
    expect(lu?.langue).toBe("fr");
  });

  it("refuse une boutique ou une ville vide — jamais d'inscription partielle", () => {
    expect(lireInscriptionFlux(reponse({ boutique: "  ", ville: "Douala" }))).toBeNull();
    expect(lireInscriptionFlux(reponse({ boutique: "Chez Amina", ville: "" }))).toBeNull();
  });

  it("applique les MEMES bornes de ville que la saisie libre", () => {
    /* Un formulaire ne doit pas faire entrer ce que la question refuse. */
    expect(lireInscriptionFlux(reponse({ boutique: "Chez Amina", ville: "D" }))).toBeNull();
  });
});

describe("lire l'avis", () => {
  it("rend une note ENTIERE et le mot", () => {
    expect(
      lireAvisFlux(reponse({ flow_token: "avis:", note: "4", mot: " Rapide et propre " })),
    ).toEqual({ note: 4, mot: "Rapide et propre" });
  });

  it("le mot est facultatif : son absence n'est pas un echec", () => {
    expect(lireAvisFlux(reponse({ note: "5" }))).toEqual({ note: 5 });
    expect(lireAvisFlux(reponse({ note: "5", mot: "   " }))).toEqual({ note: 5 });
  });

  it("refuse une note hors de 1 a 5, et une note qui n'en est pas une", () => {
    for (const note of ["0", "6", "4.5", "", "cinq"]) {
      expect(lireAvisFlux(reponse({ note }))).toBeNull();
    }
  });

  it("borne le mot comme la saisie libre — 1000 caracteres", () => {
    const lu = lireAvisFlux(reponse({ note: "5", mot: "a".repeat(5000) }));
    expect(lu?.mot).toHaveLength(1000);
  });
});

describe("la livraison n'a pas bouge", () => {
  it("se lit encore, avec ou sans jeton", () => {
    const champs = {
      ville: "Douala",
      quartier: "Bonapriso",
      repere: "en face de la pharmacie du Rond-Point",
      telephone: "690112233",
    };
    expect(lireReponseFlux(reponse(champs))).toMatchObject({ mode: "livraison", city: "Douala" });
    expect(lireReponseFlux(reponse({ flow_token: "livraison:chez-ngo", ...champs }))).toMatchObject(
      {
        mode: "livraison",
      },
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────
   Le branchement : dormant sans identifiant, et un formulaire ne repond
   jamais a la place d'un autre.
   ──────────────────────────────────────────────────────────────────────── */

const VERS = "237690112233";
const APRES_ACHAT = {
  reference: "CT-483217",
  boutique: "Chez Amina",
  contresignable: false,
  avisPossible: true,
  avisDejaDepose: false,
  avisVerifie: true,
} as never;

const ctx = (fluxAvisId?: string) =>
  ({
    vers: VERS,
    boutique: null,
    derniereCommande: APRES_ACHAT,
    ...(fluxAvisId ? { fluxAvisId } : {}),
  }) as never;

const estFlux = (m: unknown) =>
  (m as { interactive?: { type?: string } })?.interactive?.type === "flow";

describe("le formulaire d'avis s'ajoute, il ne remplace pas", () => {
  it("SANS identifiant : la liste d'etoiles seule, exactement comme avant", async () => {
    const { reagirAcheteuse } = await import("../conversation.ts");
    const r = reagirAcheteuse(
      { nom: "accueil" } as never,
      { genre: "texte", texte: "avis" },
      ctx(),
    );
    expect(r.messages.some(estFlux)).toBe(false);
    expect(r.messages).toHaveLength(1);
  });

  it("AVEC identifiant : le formulaire EN PLUS de la liste", async () => {
    const { reagirAcheteuse } = await import("../conversation.ts");
    const r = reagirAcheteuse(
      { nom: "accueil" } as never,
      { genre: "texte", texte: "avis" },
      ctx("999888777"),
    );
    expect(r.messages.some(estFlux)).toBe(true);
    /* La liste survit : un Flow ne s'affiche pas sur un WhatsApp ancien. */
    expect(r.messages.some((m) => !estFlux(m))).toBe(true);
  });

  it("une reponse d'avis depose la note ET le mot en UN effet", async () => {
    const { reagirAcheteuse } = await import("../conversation.ts");
    const r = reagirAcheteuse(
      { nom: "accueil" } as never,
      {
        genre: "flux",
        reponse: JSON.stringify({ flow_token: "avis:", note: "5", mot: "Rapide et propre" }),
      },
      ctx("999888777"),
    );
    expect(r.effet).toEqual({
      type: "deposer_avis_complet",
      note: 5,
      texte: "Rapide et propre",
    });
  });

  it("le formulaire NE CONTOURNE PAS la garde : commande non livree → refus — ADR 0101", async () => {
    /* La meme porte que la liste d'etoiles (`avisPossible`, calcule par
       `droitAuDepot`) : un Flow rempli d'avance ne depose rien tant que la
       commande n'y donne pas droit. */
    const { reagirAcheteuse } = await import("../conversation.ts");
    const r = reagirAcheteuse(
      { nom: "accueil" } as never,
      {
        genre: "flux",
        reponse: JSON.stringify({ flow_token: "avis:", note: "5", mot: "Rapide" }),
      },
      {
        vers: VERS,
        boutique: null,
        derniereCommande: { ...(APRES_ACHAT as object), avisPossible: false } as never,
      } as never,
    );
    expect(r.effet).toBeUndefined();
  });

  it("un avis DEJA depose ne se re-depose pas par le formulaire — l'unicite tient", async () => {
    const { reagirAcheteuse } = await import("../conversation.ts");
    const r = reagirAcheteuse(
      { nom: "accueil" } as never,
      {
        genre: "flux",
        reponse: JSON.stringify({ flow_token: "avis:", note: "1", mot: "encore" }),
      },
      {
        vers: VERS,
        boutique: null,
        derniereCommande: { ...(APRES_ACHAT as object), avisDejaDepose: true } as never,
      } as never,
    );
    expect(r.effet).toBeUndefined();
  });

  it("une reponse de LIVRAISON ne devient JAMAIS un avis", async () => {
    /* Les deux empruntent le meme chemin technique (`nfm_reply`) : sans le
       jeton, une livraison remplie deposerait un avis fantome. */
    const { reagirAcheteuse } = await import("../conversation.ts");
    const r = reagirAcheteuse(
      { nom: "accueil" } as never,
      {
        genre: "flux",
        reponse: JSON.stringify({
          flow_token: "livraison:chez-amina",
          ville: "Douala",
          quartier: "Bonapriso",
          repere: "en face de la pharmacie",
          telephone: "690112233",
        }),
      },
      ctx("999888777"),
    );
    expect(r.effet?.type).not.toBe("deposer_avis_complet");
    expect(r.effet?.type).not.toBe("deposer_avis");
  });
});

describe("la lecture d'un article — tache #62", () => {
  it("rend nom, prix et stock — les memes bornes que la saisie libre", () => {
    expect(
      lireArticleFlux(reponse({ nom: "Pagne wax 6 yards", prix: "15000", stock: "3" })),
    ).toEqual({ nom: "Pagne wax 6 yards", prixXaf: 15_000, stock: 3 });
  });

  it("le prix accepte les ecritures de la question : espaces, points, devise", () => {
    /* `lirePrix` est LE lecteur — le formulaire ne fait pas mieux ni pire. */
    expect(lireArticleFlux(reponse({ nom: "Sac", prix: "15 000 FCFA" }))?.prixXaf).toBe(15_000);
  });

  it("un prix illisible rend null — publier a un prix devine serait pire", () => {
    expect(lireArticleFlux(reponse({ nom: "Sac", prix: "gratuit" }))).toBeNull();
    expect(lireArticleFlux(reponse({ nom: "Sac", prix: "0" }))).toBeNull();
    expect(lireArticleFlux(reponse({ nom: "Sac" }))).toBeNull();
  });

  it("un nom hors bornes rend null — 2 a 80, comme la question", () => {
    expect(lireArticleFlux(reponse({ nom: "X", prix: "1000" }))).toBeNull();
    expect(lireArticleFlux(reponse({ nom: "y".repeat(81), prix: "1000" }))).toBeNull();
  });

  it("le stock est TOLERANT : vide, illisible ou zero valent ABSENT", () => {
    /* Champ de confort (ADR 0038) : faire echouer l'article entier pour lui
       serait la meme faute que faire echouer une inscription pour la langue.
       Et zero vaut absent — c'est la convention de la base (« non annonce »). */
    for (const stock of ["", "beaucoup", "0", "-2", "3.5", "2000000"]) {
      expect(lireArticleFlux(reponse({ nom: "Sac", prix: "1000", stock }))).toEqual({
        nom: "Sac",
        prixXaf: 1000,
      });
    }
  });

  it("la photo rend l'identifiant du media — mesure du 12/08", () => {
    /* La valeur d'un PhotoPicker est un TABLEAU d'objets media ; seul
       l'identifiant nous sert — c'est le meme genre d'identifiant qu'une
       photo du fil, et il emprunte le meme pipeline. */
    expect(
      lireArticleFlux(
        reponse({
          nom: "Sac",
          prix: "1000",
          photo: [{ id: "1713578936575692", file_name: "sac.jpg", mime_type: "image/jpeg" }],
        }),
      ),
    ).toEqual({ nom: "Sac", prixXaf: 1000, mediaId: "1713578936575692" });
  });

  it("une photo de forme inattendue vaut ABSENTE, jamais un echec", () => {
    /* Meme tolerance que le stock : l'article se publie sans photo — le
       comportement d'avant le champ, donc aucune regression possible. La
       forme LIVE du tableau n'a que la doc pour elle tant qu'une vraie
       soumission ne l'a pas confirmee : c'est precisement pour cela que
       l'inattendu doit etre un non-evenement. */
    for (const photo of [
      undefined,
      "",
      "1713578936575692",
      [],
      [{}],
      [{ id: 42 }],
      [{ id: "des espaces dedans" }],
      { id: "1713578936575692" },
    ]) {
      expect(lireArticleFlux(reponse({ nom: "Sac", prix: "1000", photo }))).toEqual({
        nom: "Sac",
        prixXaf: 1000,
      });
    }
  });

  it("la forme CDN chiffree rend ses cles — tache #72, la forme du banc du 12/08", () => {
    /* Le banc publiait des articles SANS photo : le PhotoPicker livrait cette
       forme-ci (fichier chiffre sur le CDN, cles dans la reponse), et seul le
       `media_id` etait lu. Les cles restent en base64 tel que recu — c'est
       l'adaptateur qui decode et VERIFIE. */
    const meta = {
      encryption_key: "q83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq0E=",
      hmac_key: "3q2+7xI0VniavN7xI0VniavN7xI0VniavN7xI0Vnia0=",
      iv: "ASNFZ4mrze8BI0VniavN7w==",
      plaintext_hash: "RBNvo1WzZ4oRRq0W9+hknpT7T8If536DEMBg9hyq/4o=",
      encrypted_hash: "sBNvo1WzZ4oRRq0W9+hknpT7T8If536DEMBg9hyq/4o=",
    };
    expect(
      lireArticleFlux(
        reponse({
          nom: "Sac",
          prix: "1000",
          photo: [
            {
              file_name: "sac.jpg",
              cdn_url: "https://mmg.whatsapp.net/v/t62.7118-24/abc",
              encryption_metadata: meta,
            },
          ],
        }),
      ),
    ).toEqual({
      nom: "Sac",
      prixXaf: 1000,
      photoCdn: {
        url: "https://mmg.whatsapp.net/v/t62.7118-24/abc",
        encryptionKey: meta.encryption_key,
        hmacKey: meta.hmac_key,
        iv: meta.iv,
        plaintextHash: meta.plaintext_hash,
        encryptedHash: meta.encrypted_hash,
      },
    });
  });

  it("une forme CDN incomplete ou louche vaut ABSENTE — echec ferme, jamais une levee", () => {
    const meta = {
      encryption_key: "q83vEjRWeJq83vEjRWeJq83vEjRWeJq83vEjRWeJq0E=",
      hmac_key: "3q2+7xI0VniavN7xI0VniavN7xI0VniavN7xI0Vnia0=",
      iv: "ASNFZ4mrze8BI0VniavN7w==",
      plaintext_hash: "RBNvo1WzZ4oRRq0W9+hknpT7T8If536DEMBg9hyq/4o=",
      encrypted_hash: "sBNvo1WzZ4oRRq0W9+hknpT7T8If536DEMBg9hyq/4o=",
    };
    for (const photo of [
      /* http nu : le fichier chiffre ne voyage pas en clair. */
      [{ cdn_url: "http://mmg.whatsapp.net/abc", encryption_metadata: meta }],
      /* une cle manquante */
      [
        {
          cdn_url: "https://mmg.whatsapp.net/abc",
          encryption_metadata: { ...meta, iv: undefined },
        },
      ],
      /* du non-base64 */
      [
        {
          cdn_url: "https://mmg.whatsapp.net/abc",
          encryption_metadata: { ...meta, hmac_key: "%%%pas b64%%%" },
        },
      ],
      /* pas de metadonnees du tout */
      [{ cdn_url: "https://mmg.whatsapp.net/abc" }],
    ]) {
      expect(lireArticleFlux(reponse({ nom: "Sac", prix: "1000", photo }))).toEqual({
        nom: "Sac",
        prixXaf: 1000,
      });
    }
  });

  it("l'ouverture rend la boutique ET l'article, d'une seule reponse — ADR 0087", () => {
    /* Deux ecrans, une reponse : `navigate` accumule, `complete` rend tout.
       C'est ce qui fait tomber l'ouverture de cinq messages a un formulaire. */
    expect(
      lireOuvertureFlux(
        reponse({
          boutique: "Chez Amina",
          ville: "Douala",
          langue: "fr",
          nom: "Pagne wax 6 yards",
          prix: "15 000",
          stock: "3",
        }),
      ),
    ).toEqual({
      boutique: { nomBoutique: "Chez Amina", ville: "Douala", langue: "fr" },
      article: { nom: "Pagne wax 6 yards", prixXaf: 15_000, stock: 3 },
    });
  });

  it("le second ecran laisse vide ouvre QUAND MEME la boutique", () => {
    /* Une vendeuse qui n'a pas sa photo sous la main ne doit pas rester
       dehors : l'article est facultatif au sens strict. */
    expect(lireOuvertureFlux(reponse({ boutique: "Chez Bea", ville: "Douala" }))).toEqual({
      boutique: { nomBoutique: "Chez Bea", ville: "Douala", langue: "fr" },
    });
  });

  it("un article a moitie rempli vaut ABSENT, il ne casse pas l'ouverture", () => {
    /* Un nom sans prix ne fait pas un article — et surtout pas un echec. */
    expect(
      lireOuvertureFlux(reponse({ boutique: "Chez Bea", ville: "Douala", nom: "Sac" })),
    ).toEqual({ boutique: { nomBoutique: "Chez Bea", ville: "Douala", langue: "fr" } });
  });

  it("sans boutique lisible, RIEN ne se lit — on ne range pas un article nulle part", () => {
    expect(lireOuvertureFlux(reponse({ ville: "Douala", nom: "Sac", prix: "1000" }))).toBeNull();
    expect(
      lireOuvertureFlux(reponse({ boutique: "Chez Bea", ville: "", nom: "Sac", prix: "1000" })),
    ).toBeNull();
  });

  it("son jeton se reconnait, et ne se confond avec aucun autre", () => {
    expect(genreDuJeton(reponse({ flow_token: jetonFlux("article") }))).toBe("article");
    expect(genreDuJeton(reponse({ flow_token: jetonFlux("avis") }))).not.toBe("article");
  });
});

describe("la forme du champ photo, decrite sans son contenu (ADR 0104)", () => {
  /**
   * Le 15/08/2026 au soir, un formulaire d'article rempli AVEC photo a
   * produit « Sans photo pour l'instant » : `photoDe` n'a pas reconnu la
   * forme livree par ce telephone. C'est le scenario de l'ADR 0079 — une
   * forme de plus que la documentation ne decrit pas — et on ne la DEVINE
   * pas (AGENTS.md §7.7) : on la mesure. Cette fonction rend le SQUELETTE
   * du champ — types, cles, longueurs — et jamais une valeur : ni
   * identifiant de media, ni URL de CDN (elle porte les cles de
   * dechiffrement), ni octets.
   */
  it("decrit types, cles et longueurs — jamais les valeurs", () => {
    expect(formePhotoFlux(reponse({ photo: [{ id: "SECRET-1234567890" }] }))).toBe(
      "tableau[1]:{ id: chaine(17) }",
    );
    const forme = formePhotoFlux(
      reponse({
        photo: [
          {
            cdn_url: "https://cdn.exemple/tres-secret",
            encryption_metadata: { encryption_key: "AAAA", hmac_key: "BBBB" },
          },
        ],
      }),
    );
    expect(forme).toBe(
      "tableau[1]:{ cdn_url: chaine(31), encryption_metadata: { encryption_key: chaine(4), hmac_key: chaine(4) } }",
    );
    expect(forme).not.toContain("SECRET");
    expect(forme).not.toContain("cdn.exemple");
  });

  it("les formes non reconnues se decrivent aussi — c'est leur raison d'etre", () => {
    /* Un tableau encode en CHAINE : l'hypothese du 15/08, a confirmer par
       la mesure avant toute tolerance nouvelle. */
    expect(formePhotoFlux(reponse({ photo: '[{"id":"x"}]' }))).toBe("chaine(12)");
    expect(formePhotoFlux(reponse({ photo: [] }))).toBe("tableau[0]");
    expect(formePhotoFlux(reponse({ photo: 42 }))).toBe("nombre");
    expect(formePhotoFlux(reponse({ photo: { id: "x" } }))).toBe("{ id: chaine(1) }");
  });

  it("sans champ photo, rien a decrire", () => {
    expect(formePhotoFlux(reponse({ nom: "Sac", prix: "1000" }))).toBeNull();
    expect(formePhotoFlux("pas du json")).toBeNull();
  });
});
