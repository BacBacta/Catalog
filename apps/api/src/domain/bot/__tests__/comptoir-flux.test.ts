import { describe, expect, it } from "vitest";
import { venteDepuisFlux } from "../comptoir-vendeuse.ts";
import { lireComptoirFlux } from "../flux.ts";

/**
 * Le comptoir en UN ecran — ADR 0102.
 *
 * Deux modules, deux responsabilites, et ce decoupage est le contrat :
 *
 * - `lireComptoirFlux` EXTRAIT les quatre champs bruts de la reponse Meta.
 *   Il ne valide rien au-dela de « present et non vide » ;
 * - `venteDepuisFlux` VALIDE, en rejouant `avancerComptoir` pas a pas — la
 *   machine que le fil emprunte question par question. Un formulaire ne doit
 *   pas faire entrer ce que la question refuse, et la maniere la plus sure de
 *   le garantir n'est pas un test de parite : c'est de n'avoir qu'UN valideur.
 *
 * ── Le credit partiel, propriete centrale ────────────────────────────────
 *
 * Un formulaire qui echoue sur le troisieme champ ne jette pas les deux
 * premiers : la reaction porte l'etat POSITIONNE au champ fautif, champs
 * precedents acquis. La vendeuse corrige UN champ dans le fil, pas quatre.
 */

const CHAMPS = {
  article: "Robe wax grande taille",
  prix: "12500",
  cliente: "677 00 11 22",
  remise: "Carrefour Warda, devant la pharmacie",
};

describe("venteDepuisFlux — la machine du fil valide le formulaire", () => {
  it("quatre champs sains : le récapitulatif, prêt à confirmer", () => {
    const r = venteDepuisFlux(CHAMPS);
    expect(r.type).toBe("recap");
    expect(r.ouvert).toBe(true);
    expect(r.etat).toEqual({
      pas: "recap",
      article: "Robe wax grande taille",
      prixXaf: 12500,
      /* Normalise par la MEME regle que la saisie libre. */
      cliente: "+237677001122",
      remise: "Carrefour Warda, devant la pharmacie",
    });
  });

  it("rien ne se crée : le récapitulatif du fil reste le seul chemin vers la commande", () => {
    /* La lecon de l'ADR 0032, reprise par l'ADR 0090 : tout se relit avant de
       creer. Le formulaire ne court-circuite JAMAIS la confirmation. */
    const r = venteDepuisFlux(CHAMPS);
    expect(r.type).not.toBe("creer");
    expect(r).not.toHaveProperty("vente");
  });

  it("prix illisible : refus AU pas du prix, l'article reste acquis", () => {
    const r = venteDepuisFlux({ ...CHAMPS, prix: "douze mille" });
    expect(r.type).toBe("refus");
    expect(r.motif).toBe("prix_illisible");
    expect(r.etat).toEqual({ pas: "prix", article: "Robe wax grande taille" });
  });

  it("numéro illisible : refus AU pas de la cliente, article et prix acquis", () => {
    const r = venteDepuisFlux({ ...CHAMPS, cliente: "pas un numero" });
    expect(r.type).toBe("refus");
    expect(r.motif).toBe("numero_illisible");
    expect(r.etat).toEqual({ pas: "cliente", article: "Robe wax grande taille", prixXaf: 12500 });
  });

  it("remise trop courte : refus au dernier pas, tout le reste acquis", () => {
    const r = venteDepuisFlux({ ...CHAMPS, remise: "la" });
    expect(r.type).toBe("refus");
    expect(r.motif).toBe("remise_trop_courte");
    expect(r.etat).toMatchObject({ pas: "remise", cliente: "+237677001122" });
  });

  it("article vide : refus au premier pas — l'état est le départ", () => {
    const r = venteDepuisFlux({ ...CHAMPS, article: " " });
    expect(r.type).toBe("refus");
    expect(r.motif).toBe("article_vide");
    expect(r.etat).toEqual({ pas: "article" });
  });

  it("un prix négatif est une faute de saisie, pas une remise commerciale", () => {
    const r = venteDepuisFlux({ ...CHAMPS, prix: "-500" });
    expect(r.type).toBe("refus");
    expect(r.motif).toBe("prix_negatif");
  });

  it("« annuler » tapé DANS un champ n'annule rien : c'est une valeur, pas un geste", () => {
    /* Dans le fil, « annuler » ferme le comptoir — c'est un mot adresse au
       bot. Dans un formulaire, c'est le contenu d'un champ : une vendeuse qui
       vend un article nomme « annuler » est improbable, mais la traiter comme
       un ordre transformerait une valeur en commande. Le champ est refuse ou
       accepte selon ses regles, jamais interprete. */
    const r = venteDepuisFlux({ ...CHAMPS, remise: "annuler le marché" });
    expect(r.type).toBe("recap");
    expect(r.etat).toMatchObject({ pas: "recap", remise: "annuler le marché" });
  });

  it("le mot EXACT « annuler » dans un champ refuse le champ, sans fermer le comptoir", () => {
    /* `avancerComptoir` le lirait en geste d'abandon. Ici c'est une valeur
       ambigue : on refuse le champ au motif de SON pas, champs precedents
       acquis, et la question du fil reprend — jamais « C'est annulé » en
       reponse a un formulaire rempli. */
    const r = venteDepuisFlux({ ...CHAMPS, remise: "annuler" });
    expect(r.type).toBe("refus");
    expect(r.motif).toBe("remise_trop_courte");
    expect(r.ouvert).toBe(true);
    expect(r.etat).toMatchObject({ pas: "remise", cliente: "+237677001122" });
  });
});

describe("lireComptoirFlux — l'extraction, et rien d'autre", () => {
  const brut = (d: Record<string, unknown>) => JSON.stringify(d);

  it("relit les quatre champs, espaces compris — la validation n'est pas son travail", () => {
    expect(lireComptoirFlux(brut({ ...CHAMPS, flow_token: "comptoir:" }))).toEqual(CHAMPS);
  });

  it("un champ absent ou vide rend null : quatre faits, pas trois", () => {
    for (const manquant of ["article", "prix", "cliente", "remise"]) {
      const d: Record<string, unknown> = { ...CHAMPS, flow_token: "comptoir:" };
      delete d[manquant];
      expect(lireComptoirFlux(brut(d)), `sans ${manquant}`).toBeNull();
      expect(lireComptoirFlux(brut({ ...d, [manquant]: "  " })), `${manquant} vide`).toBeNull();
    }
  });

  it("du JSON illisible rend null, jamais une levée", () => {
    expect(lireComptoirFlux("pas du json")).toBeNull();
    expect(lireComptoirFlux("[1,2]")).toBeNull();
  });
});
