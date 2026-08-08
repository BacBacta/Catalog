import { describe, expect, it } from "vitest";
import { reagirAcheteuse } from "../conversation.ts";
import {
  boutons,
  CORPS_INTERACTIF_MAX,
  liste,
  type MessageBoutons,
  type MessageListe,
  type MessageTexte,
  texte,
} from "../messages.ts";

/**
 * On choisit, on ne tape plus — ADR 0053.
 *
 * L'audit du 07/08/2026 a chiffre le mal de fond : 6 etats sur 14 (43 %)
 * exigent une saisie clavier, et 5 n'envoient JAMAIS un bouton. Sur un
 * clavier de telephone, a Douala, entre deux clientes, chaque champ libre
 * est un piege.
 */

const VERS = "237690112233";
const corps = (m: unknown): string =>
  (m as MessageTexte).text?.body ??
  (m as MessageBoutons).interactive?.body?.text ??
  (m as MessageListe).interactive?.body?.text ??
  "";
/** Tous les identifiants CHOISISSABLES d'un message, quelle que soit sa forme. */
const choix = (m: unknown): string[] => {
  const a = (m as MessageListe | MessageBoutons).interactive?.action as
    | {
        sections?: Array<{ rows: Array<{ id: string }> }>;
        buttons?: Array<{ reply: { id: string } }>;
      }
    | undefined;
  return [
    ...(a?.sections?.flatMap((sec) => sec.rows.map((r) => r.id)) ?? []),
    ...(a?.buttons?.map((b) => b.reply.id) ?? []),
  ];
};
/** Le message de quantite : le dernier qui propose des lignes `qte:`. */
const messageQuantite = (ms: unknown[]) =>
  ms.filter((m) => choix(m).some((c) => c.startsWith("qte:"))).at(-1);

const BOUTIQUE = {
  slug: "chez-amina",
  nom: "Chez Amina",
  ville: "Douala",
  whatsappVendeuse: "+237690000001",
  articles: [{ id: "a1", nom: "Robe wax", prixXaf: 15000, stock: null }],
} as never;
const ctx = { vers: VERS, boutique: BOUTIQUE };
const P = [{ articleId: "a1", quantite: 1 }];

describe("la limite d'un corps INTERACTIF n'est pas celle d'un texte", () => {
  it("un corps interactif tient sous 1024, pas sous 4096", () => {
    /* 4096 est la limite d'un message TEXTE. Celle d'un corps a boutons ou a
       liste est de 1024 : un corps entre les deux passait la validation
       locale et mourait en HTTP 400 a l'envoi, sans message pour personne. */
    expect(CORPS_INTERACTIF_MAX).toBe(1024);
    const trop = "a".repeat(2000);
    const m = boutons(VERS, trop, [{ id: "x", titre: "X" }]) as MessageBoutons;
    expect(m.interactive.body.text.length).toBeLessThanOrEqual(CORPS_INTERACTIF_MAX);
  });

  it("une LISTE suit la meme borne", () => {
    const m = liste(VERS, "a".repeat(2000), "Voir", [
      { id: "x", titre: "X", description: "" },
    ]) as MessageListe;
    expect(m.interactive.body.text.length).toBeLessThanOrEqual(CORPS_INTERACTIF_MAX);
  });

  it("un message TEXTE garde ses 4096 — on n'a rien retreci au passage", () => {
    const m = texte(VERS, "a".repeat(3000)) as MessageTexte;
    expect(m.text.body.length).toBe(3000);
  });
});

describe("la quantite se CHOISIT, meme au-dela de deux", () => {
  const ETAT = { nom: "quantite", slug: "chez-amina", articleId: "a1", panier: [] } as never;

  it("une liste de 1 a 8 remplace la saisie clavier", () => {
    const fiche = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 } as never,
      { genre: "liste", id: "art:a1" },
      ctx,
    );
    const r = reagirAcheteuse(fiche.etat as never, { genre: "bouton", id: "cmd:a1" }, ctx);
    const q = messageQuantite(r.messages);
    expect(choix(q)).toEqual([
      "qte:1",
      "qte:2",
      "qte:3",
      "qte:4",
      "qte:5",
      "qte:6",
      "qte:7",
      "qte:8",
      "qte:autre",
      /* La boutique de ce test est joignable : la derniere ligne est la
         sortie vers la vendeuse. Sans numero, ce serait « menu » — jamais
         un cul-de-sac. */
      "vendeuse",
    ]);
  });

  it("chaque ligne de la liste commande vraiment", () => {
    for (const n of [1, 3, 5, 8]) {
      const r = reagirAcheteuse(ETAT, { genre: "liste", id: `qte:${n}` }, ctx);
      expect((r.etat as { panier: Array<{ quantite: number }> }).panier[0]?.quantite).toBe(n);
    }
  });

  it("le stock borne la liste — on ne propose pas ce qui n'existe pas", () => {
    const rare = {
      ...(BOUTIQUE as object),
      articles: [{ id: "a1", nom: "Robe wax", prixXaf: 15000, stock: 3 }],
    } as never;
    const c = { vers: VERS, boutique: rare };
    const fiche = reagirAcheteuse(
      { nom: "catalogue", slug: "chez-amina", page: 0 } as never,
      { genre: "liste", id: "art:a1" },
      c,
    );
    const r = reagirAcheteuse(fiche.etat as never, { genre: "bouton", id: "cmd:a1" }, c);
    /* Stock 3 : trois lignes, PAS de « un autre nombre » — il n'y a rien
       au-dela —, et la sortie vendeuse. */
    expect(choix(messageQuantite(r.messages))).toEqual(["qte:1", "qte:2", "qte:3", "vendeuse"]);
  });

  it("la saisie clavier marche TOUJOURS — on ajoute un chemin, on n'en retire pas", () => {
    const r = reagirAcheteuse(ETAT, { genre: "texte", texte: "12" }, ctx);
    expect((r.etat as { panier: Array<{ quantite: number }> }).panier[0]?.quantite).toBe(12);
  });
});

describe("l'invariant du produit tient DANS le tunnel", () => {
  /* AGENTS.md §1 : « l'acheteuse et la vendeuse continuent de se parler sur
     WhatsApp ». Le bouton n'existait qu'a l'accueil : l'invariant etait
     suspendu pendant les six tours les plus decisifs. */
  it("« Parler a la vendeuse » est offert a chaque etape", () => {
    const etapes = [
      { nom: "quantite", slug: "chez-amina", articleId: "a1", panier: [] },
      { nom: "ajout", slug: "chez-amina", panier: P },
      { nom: "mode", slug: "chez-amina", panier: P },
      { nom: "ville", slug: "chez-amina", panier: P },
    ] as never[];
    for (const etat of etapes) {
      const r = reagirAcheteuse(etat, { genre: "bouton", id: "id:inconnu" }, ctx);
      const tous = r.messages.flatMap(choix);
      expect(tous, `etape ${(etat as { nom: string }).nom}`).toContain("vendeuse");
    }
  });
});

describe("« Corriger » corrige la livraison, il ne renvoie pas au panier", () => {
  const RECAP = {
    nom: "recap",
    slug: "chez-amina",
    panier: P,
    mode: "livraison",
    ville: "Douala",
    livraison: {
      mode: "livraison",
      city: "Douala",
      quartier: "Bonapriso",
      landmark: "en face de la pharmacie",
      phone: "+237690112233",
    },
  } as never;

  it("il rouvre la SAISIE de livraison, panier intact", () => {
    const r = reagirAcheteuse(RECAP, { genre: "bouton", id: "corriger" }, ctx);
    const etat = r.etat as { nom: string; panier: unknown[] };
    expect(etat.nom).toBe("details");
    expect(etat.panier).toEqual(P);
  });

  it("le panier se retrouve par « panier », pas en perdant sa livraison", () => {
    const r = reagirAcheteuse(RECAP, { genre: "texte", texte: "panier" }, ctx);
    expect((r.etat as { nom: string }).nom).not.toBe("details");
  });
});
