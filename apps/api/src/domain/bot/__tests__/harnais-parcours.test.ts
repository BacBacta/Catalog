/**
 * Les deux parcours nominaux, JOUÉS par le harnais — audit pipeline 2026-08.
 *
 * Chaque scénario s'écrit en instantané lisible (`__instantanes__/`) : une
 * régression de copie se voit dans un diff, pas dans une relecture. Les
 * assertions ne redisent pas la copie — elles tiennent la STRUCTURE (l'effet
 * attendu, l'état atteint, jamais un pas muet).
 */

import { describe, expect, it } from "vitest";
import type { FixturesHarnais } from "./harnais.ts";
import { instantane, Pilote } from "./harnais.ts";

/** Le SMS MTN de réception, copié de docs/formats-sms-operateurs.md. */
const SMS_MTN_RECU =
  "Vous avez recu 26800 XAF de ALPHA TRADING SARL (237652000001 ) sur votre compte Mobile Money 2026-06-23 09:50:32. Message de l'expediteur:. Votre nouveau solde est de 29398 FCFA. Frais: 0 XAF. Transaction ID: 17600000002.Prix Cassés chez MoMo pour tout le monde !";

const BOUTIQUE: NonNullable<FixturesHarnais["boutiques"]>[string] = {
  id: "seller-1",
  slug: "chez-bintou",
  nom: "Chez Bintou",
  ville: "Douala",
  whatsappVendeuse: "237699887712",
  reversementPose: true,
  reputation: { note: 4.8, nbVerifies: 8 },
  aDesPhotos: false,
  articles: [
    { id: "a-sac-000001", nom: "Sac tressé", prixXaf: 8500, stock: 2 },
    { id: "a-pagne-0002", nom: "Pagne wax 6 yards", prixXaf: 15000, stock: null },
    { id: "a-huile-0003", nom: "Huile de palme 5 L", prixXaf: 4500, stock: null },
  ],
};

describe("parcours acheteuse — du lien à la commande", () => {
  it("va du lien de boutique à l'effet creer_commande, sans un pas muet", async () => {
    const p = new Pilote({ estVendeuse: false, boutiques: { "chez-bintou": BOUTIQUE } });

    p.jouer({ genre: "texte", texte: "boutique chez-bintou" });
    p.jouer({ genre: "bouton", id: "catalogue" });
    p.jouer({ genre: "liste", id: "art:a-sac-000001" });
    p.jouer({ genre: "bouton", id: "cmd:a-sac-000001" });
    p.jouer({ genre: "liste", id: "qte:2" });
    p.jouer({ genre: "bouton", id: "commander" });
    p.jouer({ genre: "bouton", id: "mode:livraison" });
    p.jouer({ genre: "texte", texte: "Douala" });
    p.jouer({ genre: "texte", texte: "Bonapriso, en face de la pharmacie du Rail, 6 52 00 00 01" });
    const fin = p.jouer({ genre: "bouton", id: "confirmer" });

    /* La commande naît — c'est l'effet, pas un message, qui la crée. */
    expect(fin.effet).toMatchObject({ type: "creer_commande" });
    /* Aucun pas muet : chaque geste a reçu au moins un message ou un effet. */
    for (const pas of p.journal) {
      expect(pas.messages.length > 0 || pas.effet !== undefined).toBe(true);
    }
    await expect(instantane(p)).toMatchFileSnapshot("__instantanes__/parcours-acheteuse.txt");
  });

  it("le récapitulatif précède la commande — « confirmer » tapé dans le tunnel ne contresigne rien", () => {
    const p = new Pilote({ estVendeuse: false, boutiques: { "chez-bintou": BOUTIQUE } });
    p.jouer({ genre: "texte", texte: "boutique chez-bintou" });
    p.jouer({ genre: "liste", id: "art:a-sac-000001" });
    p.jouer({ genre: "bouton", id: "cmd:a-sac-000001" });
    p.jouer({ genre: "liste", id: "qte:1" });
    /* ADR 0051 : dans le tunnel, les mots de l'après-achat se taisent. */
    const pas = p.jouer({ genre: "texte", texte: "confirmer" });
    expect(pas.effet).toBeUndefined();
    expect(p.etatConv().nom).not.toBe("accueil");
  });
});

describe("parcours vendeuse — de l'inscription à la preuve", () => {
  it("va de « vendre » au SMS collé, chaque service en une carte", async () => {
    const p = new Pilote({
      estVendeuse: false,
      vendeuse: {
        commandesOuvertes: [{ id: "o-1", reference: "CT-104312", resteXaf: 10750 }],
        soldesXaf: 10750,
        boutique: {
          nom: "Chez Bintou",
          nbArticles: 1,
          lienBoutique: "https://boutique.catalog.cm/chez-bintou",
          lienEspace: "https://app.catalog.cm",
        },
      },
    });

    p.jouer({ genre: "texte", texte: "vendre avec amina" });
    p.jouer({ genre: "texte", texte: "Chez Bintou" });
    const creation = p.jouer({ genre: "texte", texte: "Douala" });
    expect(creation.effet).toMatchObject({
      type: "creer_boutique",
      nomBoutique: "Chez Bintou",
      parrain: "amina",
    });

    /* La boutique existe désormais : la suite se joue en vendeuse installée. */
    const q = new Pilote({
      estVendeuse: true,
      vendeuse: {
        commandesOuvertes: [{ id: "o-1", reference: "CT-104312", resteXaf: 10750 }],
        soldesXaf: 10750,
        boutique: {
          nom: "Chez Bintou",
          nbArticles: 1,
          lienBoutique: "https://boutique.catalog.cm/chez-bintou",
          lienEspace: "https://app.catalog.cm",
        },
      },
    });

    /* La photo légendée : LE geste du terrain (ADR 0035). */
    q.jouer({ genre: "image", mediaId: "m-1", legende: "Pagne wax 6 yards 15 000" });
    const publie = q.jouer({ genre: "bouton", id: "publier" });
    expect(publie.effet).toMatchObject({
      type: "creer_article",
      nom: "Pagne wax 6 yards",
      prixXaf: 15000,
    });

    /* Le SMS collé traverse tout et part en vérification. */
    const sms = q.jouer({ genre: "texte", texte: SMS_MTN_RECU });
    expect(sms.effet).toMatchObject({ type: "verifier_sms" });

    /* La remise, le solde, les congés — un mot chacun. */
    expect(q.jouer({ genre: "texte", texte: "livrée CT-104312" }).effet).toMatchObject({
      type: "marquer_livree",
      reference: "CT-104312",
    });
    expect(q.jouer({ genre: "texte", texte: "solde" }).messages.length).toBeGreaterThan(0);
    expect(q.jouer({ genre: "texte", texte: "congés" }).effet).toMatchObject({
      type: "basculer_conges",
      fermer: true,
    });

    await expect(
      instantane(p) + "\n═══ vendeuse installée ═══\n" + instantane(q),
    ).toMatchFileSnapshot("__instantanes__/parcours-vendeuse.txt");
  });

  it("un SMS collé PENDANT un formulaire d'article traverse (règle 0, ADR 0052)", () => {
    const p = new Pilote({
      estVendeuse: true,
      vendeuse: { commandesOuvertes: [], soldesXaf: 0, boutique: null },
    });
    /* Une photo SANS légende lisible ouvre le formulaire et y reste. */
    p.jouer({ genre: "image", mediaId: "m-2" });
    expect(p.etatVendeuse()?.nom).toBe("article_nom");
    const sms = p.jouer({ genre: "texte", texte: SMS_MTN_RECU });
    expect(sms.fil).toBe("vendeuse");
    expect(sms.effet).toMatchObject({ type: "verifier_sms" });
    /* Le formulaire n'est pas détruit. */
    expect(p.etatVendeuse()?.nom).toBe("article_nom");
  });
});
