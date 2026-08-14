import { describe, expect, it } from "vitest";
import {
  type CommandePourExpiration,
  doitExpirer,
  echeance,
  etatExpiration,
  FENETRE_EXPIRATION_MS,
  RAPPELS_HEURES,
} from "../domain/order/expiration.ts";

/**
 * L'expiration a 48 h et ses rappels.
 *
 * **Le temps courant est toujours passe en parametre.** Aucun test ici ne
 * depend de l'heure a laquelle il tourne : c'est la seule facon de verifier le
 * comportement AU BORD de la fenetre, qui est precisement le cas ou une erreur
 * d'une heure passe inapercue en local et casse en CI.
 */

const CREE = new Date("2026-07-30T08:00:00+01:00");
const H = 60 * 60_000;

const plus = (heures: number) => new Date(CREE.getTime() + heures * H);

const commande = (p: Partial<CommandePourExpiration> = {}): CommandePourExpiration => ({
  creeA: CREE,
  argentEncaisse: false,
  annuleeA: null,
  rappelsEnvoyes: [],
  ...p,
});

describe("echeance", () => {
  it("tombe 48 h apres la creation", () => {
    expect(FENETRE_EXPIRATION_MS).toBe(48 * H);
    expect(echeance(CREE).toISOString()).toBe(plus(48).toISOString());
  });
});

describe("etatExpiration — la fenetre", () => {
  it("vivante juste avant l'echeance", () => {
    const r = etatExpiration(commande(), new Date(plus(48).getTime() - 1));
    expect(r.etat).toBe("vivante");
    if (r.etat !== "vivante") return;
    expect(r.resteMs).toBe(1);
  });

  it("expiree EXACTEMENT a l'echeance", () => {
    // Le bord compte : a 48 h pile, la commande est morte. Un `>` au lieu d'un
    // `>=` laisserait vivre une commande une milliseconde de trop, ce qui ne se
    // voit qu'ici.
    const r = etatExpiration(commande(), plus(48));
    expect(r.etat).toBe("expiree");
    if (r.etat !== "expiree") return;
    expect(r.depuisMs).toBe(0);
  });

  it("compte le temps ecoule depuis l'echeance", () => {
    const r = etatExpiration(commande(), plus(50));
    expect(r.etat).toBe("expiree");
    if (r.etat !== "expiree") return;
    expect(r.depuisMs).toBe(2 * H);
  });

  it("annonce le temps restant", () => {
    const r = etatExpiration(commande(), plus(10));
    expect(r.etat).toBe("vivante");
    if (r.etat !== "vivante") return;
    expect(r.resteMs).toBe(38 * H);
  });

  it("la fenetre est un parametre : on peut la raccourcir sans toucher au code", () => {
    const r = etatExpiration(commande(), plus(3), 2 * H);
    expect(r.etat).toBe("expiree");
  });
});

describe("etatExpiration — ce qui n'expire pas", () => {
  it("une commande PAYEE n'expire pas, meme trois jours apres", () => {
    const r = etatExpiration(commande({ argentEncaisse: true }), plus(72));
    expect(r).toEqual({ etat: "hors_champ", raison: "argent_encaisse" });
  });

  /**
   * ── L'ARBITRAGE du 14/08 — ADR 0101 ────────────────────────────────────
   *
   * Un ACOMPTE paye suffit. Le solde n'a pas besoin d'etre couvert : des
   * qu'un franc est entre sur le portefeuille de la vendeuse, la commande
   * sort du champ de l'expiration.
   *
   * Le predicat etait `soldeRegle` — « le total attendu est couvert » —, et
   * il faisait donc expirer une commande dont l'acheteuse avait reellement
   * paye la moitie. Catalog ne detient aucun fonds (AGENTS.md §2) : faire
   * « expirer » une commande payee suggererait un retour d'argent qu'il ne
   * peut pas faire. Et un acompte prouve porte un RECU — l'expirer
   * l'orphelinerait.
   */
  it("un ACOMPTE paye suffit : le solde n'a pas a etre couvert", () => {
    const r = etatExpiration(commande({ argentEncaisse: true }), plus(72));
    expect(r).toEqual({ etat: "hors_champ", raison: "argent_encaisse" });
  });

  it("zero franc encaisse : elle expire, c'est le seul cas", () => {
    expect(etatExpiration(commande({ argentEncaisse: false }), plus(49)).etat).toBe("expiree");
  });

  it("une commande ANNULEE n'expire pas", () => {
    const r = etatExpiration(commande({ annuleeA: plus(1) }), plus(72));
    expect(r).toEqual({ etat: "hors_champ", raison: "annulee" });
  });

  it("payee l'emporte sur annulee — on ne fait pas expirer de l'argent recu", () => {
    const r = etatExpiration(commande({ argentEncaisse: true, annuleeA: plus(1) }), plus(72));
    expect(r).toMatchObject({ raison: "argent_encaisse" });
  });
});

describe("etatExpiration — les rappels", () => {
  const dus = (now: Date, envoyes: number[] = []) => {
    const r = etatExpiration(commande({ rappelsEnvoyes: envoyes }), now);
    return r.etat === "vivante" ? r.rappelsDus : [];
  };

  it("les rappels sont a 2 h et 24 h ECOULEES depuis la creation", () => {
    expect([...RAPPELS_HEURES]).toEqual([2, 24]);
  });

  it("aucun rappel avant la premiere echeance", () => {
    expect(dus(plus(0))).toEqual([]);
    expect(dus(new Date(plus(2).getTime() - 1))).toEqual([]);
  });

  it("le rappel de 2 h est du a 2 h pile", () => {
    expect(dus(plus(2))).toEqual([2]);
  });

  it("les deux rappels sont dus a 24 h si aucun n'est parti", () => {
    // RATTRAPAGE : un job arrete pendant vingt heures ne perd pas le rappel de
    // 2 h. Sans cela, une panne d'infrastructure priverait l'acheteuse d'un
    // rappel qu'elle ne recevra jamais.
    expect(dus(plus(24))).toEqual([2, 24]);
  });

  it("IDEMPOTENCE : un rappel deja envoye ne ressort jamais", () => {
    // Le job peut tourner toutes les minutes sans inonder l'acheteuse.
    expect(dus(plus(24), [2])).toEqual([24]);
    expect(dus(plus(24), [2, 24])).toEqual([]);
    expect(dus(plus(47), [2, 24])).toEqual([]);
  });

  it("AUCUN rappel apres l'expiration", () => {
    // Rappeler une commande morte ne sert qu'a faire honte a l'acheteuse.
    const r = etatExpiration(commande({ rappelsEnvoyes: [] }), plus(49));
    expect(r.etat).toBe("expiree");
    expect(r).not.toHaveProperty("rappelsDus");
  });

  it("aucun rappel sur une commande payee ou annulee", () => {
    for (const p of [{ argentEncaisse: true }, { annuleeA: plus(1) }]) {
      const r = etatExpiration(commande(p), plus(24));
      expect(r.etat).toBe("hors_champ");
    }
  });

  it("un rappel inconnu dans la liste des envoyes ne casse rien", () => {
    // Une valeur heritee d'une version precedente ne doit pas faire disparaitre
    // les rappels legitimes.
    expect(dus(plus(24), [99])).toEqual([2, 24]);
  });

  it("les rappels sortent dans l'ordre chronologique", () => {
    const l = dus(plus(30));
    expect(l).toEqual([...l].sort((a, b) => a - b));
  });
});

describe("doitExpirer", () => {
  it("resume l'etat en un booleen", () => {
    expect(doitExpirer(commande(), plus(47))).toBe(false);
    expect(doitExpirer(commande(), plus(48))).toBe(true);
    expect(doitExpirer(commande({ argentEncaisse: true }), plus(72))).toBe(false);
  });
});

describe("determinisme", () => {
  it("deux appels avec le meme `now` donnent le meme resultat", () => {
    // C'est ce que garantit le passage du temps en parametre. Un `Date.now()` lu
    // dans le domaine rendrait ce test faux une fois sur mille, a l'heure pile.
    const now = plus(24);
    const a = etatExpiration(commande(), now);
    const b = etatExpiration(commande(), now);
    expect(a).toEqual(b);
  });

  it("le resultat ne depend pas du fuseau de lecture, seulement des durees", () => {
    // Les deux instants sont le meme point du temps, ecrits dans deux fuseaux.
    const douala = new Date("2026-07-30T08:00:00+01:00");
    const utc = new Date("2026-07-30T07:00:00Z");
    expect(douala.getTime()).toBe(utc.getTime());
    expect(etatExpiration({ ...commande(), creeA: douala }, plus(24))).toEqual(
      etatExpiration({ ...commande(), creeA: utc }, plus(24)),
    );
  });
});
