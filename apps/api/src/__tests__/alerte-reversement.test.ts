import { describe, expect, it } from "vitest";
import {
  decisionAlerte,
  decisionGel,
  effetDuGel,
  FENETRE_STOP_MS,
} from "../domain/securite/alerte-reversement.ts";

/**
 * L'alerte a l'ancien numero et le gel — ADR 0061, rang 2b.
 *
 * Le scenario que ces tests protegent : un telephone vole. Celui qui le tient
 * tient le compte, donc le numero sur lequel les acheteuses paient. La seule
 * voie qui ne passe pas par l'appareil vole est l'AUTRE puce — et la double
 * SIM est la norme (AGENTS.md §2).
 */

const MAINTENANT = new Date("2026-08-11T20:00:00+01:00");
const ANCIEN = "+237690000001";
const NOUVEAU = "+237690000002";

describe("faut-il alerter, et qui", () => {
  it("alerte l'ANCIEN numero — jamais le nouveau, jamais celui de connexion", () => {
    const d = decisionAlerte({ ancienNumero: ANCIEN, nouveauNumero: NOUVEAU });
    expect(d).toEqual({ alerter: true, vers: ANCIEN });
  });

  /**
   * **La premiere pose n'est pas un signal de vol**, et alerter le numero de
   * connexion serait pire que se taire : sur un appareil vole, il est deja
   * entre les mains du voleur — l'alerte lui apprendrait qu'un garde-fou
   * existe, et rien a personne d'autre.
   */
  it("se tait a la premiere pose : il n'y a personne a prevenir", () => {
    expect(decisionAlerte({ ancienNumero: null, nouveauNumero: NOUVEAU })).toEqual({
      alerter: false,
      motif: "premiere_pose",
    });
  });

  it("se tait quand le numero ne change pas", () => {
    expect(decisionAlerte({ ancienNumero: ANCIEN, nouveauNumero: ANCIEN })).toEqual({
      alerter: false,
      motif: "inchange",
    });
  });
});

describe("le STOP qui gele", () => {
  const alerteA = new Date(MAINTENANT.getTime() - 60_000);

  it("gele sur « STOP », quelle que soit la casse et les espaces", () => {
    for (const t of ["STOP", "stop", " Stop ", "  sToP\n"]) {
      expect(decisionGel({ texte: t, alerteEnvoyeeA: alerteA, maintenant: MAINTENANT })).toEqual({
        geler: true,
      });
    }
  });

  /**
   * **Le STOP ne vaut que s'il repond a une alerte.** Sans cette condition, un
   * desabonnement ou une faute de frappe gelerait le reversement d'une
   * vendeuse qui n'a rien demande.
   */
  it("ne gele pas un STOP qui ne repond a aucune alerte", () => {
    expect(decisionGel({ texte: "STOP", alerteEnvoyeeA: null, maintenant: MAINTENANT })).toEqual({
      geler: false,
      motif: "aucune_alerte",
    });
  });

  it("ne gele pas au-dela de la fenetre de sept jours", () => {
    const vieux = new Date(MAINTENANT.getTime() - FENETRE_STOP_MS - 1000);
    expect(decisionGel({ texte: "STOP", alerteEnvoyeeA: vieux, maintenant: MAINTENANT })).toEqual({
      geler: false,
      motif: "hors_fenetre",
    });
  });

  /** Sept jours pile passent encore : la vendeuse ne compte pas les heures. */
  it("accepte le dernier instant de la fenetre", () => {
    const limite = new Date(MAINTENANT.getTime() - FENETRE_STOP_MS);
    expect(decisionGel({ texte: "STOP", alerteEnvoyeeA: limite, maintenant: MAINTENANT })).toEqual({
      geler: true,
    });
  });

  it("ne prend pas un message qui CONTIENT « stop » pour un STOP", () => {
    for (const t of ["stop les frais", "non stop", "arrêt stop svp"]) {
      expect(decisionGel({ texte: t, alerteEnvoyeeA: alerteA, maintenant: MAINTENANT })).toEqual({
        geler: false,
        motif: "pas_un_stop",
      });
    }
  });
});

describe("ce que le gel fait", () => {
  const e = effetDuGel(MAINTENANT);

  /**
   * **On arrete l'argent, on ne le redirige pas.** Revenir a l'ancien numero
   * supposerait de savoir qui le tient AUJOURD'HUI — on sait seulement que
   * quelqu'un le tenait a l'instant du STOP.
   */
  it("efface le reversement au lieu de revenir a l'ancien numero", () => {
    expect(e.payoutPhone).toBeNull();
    expect(e.payoutPhoneVerifiedAt).toBeNull();
    expect(e.payoutOperator).toBeNull();
    expect(Object.values(e)).not.toContain(ANCIEN);
  });

  /**
   * **Le gel ne ferme pas la boutique.** Fermer punirait la victime du vol.
   * Sans reversement pose, le bot sait deja faire : on commande, on ne paie
   * pas d'avance.
   */
  it("ne touche NI au statut de la boutique, NI aux conges, NI aux commandes", () => {
    expect(Object.keys(e).sort()).toEqual([
      "payoutOperator",
      "payoutPhone",
      "payoutPhoneVerifiedAt",
      "reversementGeleDepuis",
    ]);
  });

  it("date le gel, pour qu'un humain sache quand il a commence", () => {
    expect(e.reversementGeleDepuis).toEqual(MAINTENANT);
  });
});
