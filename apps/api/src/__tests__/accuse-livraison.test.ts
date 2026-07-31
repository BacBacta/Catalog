import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  interpreter,
  lireAccuse,
  operateurProbable,
  STATUTS_ORANGE,
} from "../domain/sms/livraison.ts";
import { familleDe } from "../middleware/debit.ts";
import { classeDuChemin } from "../middleware/securite.ts";
import { accuseLivraisonRoutes } from "../routes/accuse-livraison.ts";

/**
 * Les accuses de livraison d'Orange.
 *
 * Ils repondent a deux questions que rien d'autre ne peut trancher : le message
 * est-il ARRIVE, et **les vendeuses MTN le recoivent-elles**. La seconde est la
 * seule verification automatique du fait que l'application est souscrite a la
 * bonne des deux offres SMS d'Orange (voir `adapters/sms-orange.ts`).
 */

const SECRET = "s3cret-de-rappel-32-caracteres-ab";

const notification = (adresse: string, statut: string, correlation?: string) => ({
  deliveryInfoNotification: {
    ...(correlation ? { callbackData: correlation } : {}),
    deliveryInfo: { address: adresse, deliveryStatus: statut },
  },
});

/* ═══════════════════════ interpretation ═══════════════════════ */

describe("interpreter un statut de livraison", () => {
  it("couvre les cinq statuts d'Orange", () => {
    for (const s of STATUTS_ORANGE) {
      expect(interpreter(s).explication.length).toBeGreaterThan(10);
    }
  });

  /**
   * ══════════════════════════════════════════════════════════════════════
   *  UNE SEULE VALEUR EST SURE
   * ══════════════════════════════════════════════════════════════════════
   *
   * La documentation Orange est explicite : derriere `DeliveryImpossible`, le
   * SMS peut avoir ete delivre quand meme — telephone eteint plus de 24 h,
   * numero fixe, numero desaffecte. Compter ces cas comme des echecs surs
   * ferait conclure a une panne de couverture la ou il n'y a que des
   * telephones eteints.
   */
  it("seul DeliveredToTerminal est certain", () => {
    const certains = STATUTS_ORANGE.filter((s) => interpreter(s).certain);
    expect(certains).toEqual(["DeliveredToTerminal"]);
  });

  it("un echec annonce reste « possible », jamais acquis", () => {
    const v = interpreter("DeliveryImpossible");
    expect(v.etat).toBe("echec_possible");
    expect(v.certain).toBe(false);
    expect(v.explication).toMatch(/NON concluant/);
  });

  it("les etats transitoires ne sont ni succes ni echec", () => {
    expect(interpreter("DeliveredToNetwork").etat).toBe("en_cours");
    expect(interpreter("MessageWaiting").etat).toBe("en_cours");
    expect(interpreter("DeliveryUncertain").etat).toBe("inconnu");
  });

  /**
   * Un statut nouveau ne doit pas faire tomber la route de rappel. Il compte
   * comme inconnu, et le tableau de bord le montrera sous son vrai nom.
   */
  it("un statut inconnu ne leve pas", () => {
    const v = interpreter("QuelqueChoseDeNouveau");
    expect(v.etat).toBe("inconnu");
    expect(v.explication).toContain("QuelqueChoseDeNouveau");
  });
});

/* ═══════════════════════ operateur probable ═══════════════════════ */

describe("operateur deduit du prefixe", () => {
  it("reconnait les plages connues", () => {
    expect(operateurProbable("+237677000001")).toBe("mtn");
    expect(operateurProbable("+237680000001")).toBe("mtn");
    expect(operateurProbable("+237651000001")).toBe("mtn");
    expect(operateurProbable("+237699000001")).toBe("orange");
    expect(operateurProbable("+237656000001")).toBe("orange");
    expect(operateurProbable("+237620000001")).toBe("camtel");
  });

  it("accepte les formes avec ou sans indicatif", () => {
    expect(operateurProbable("677000001")).toBe("mtn");
    expect(operateurProbable("237677000001")).toBe("mtn");
    expect(operateurProbable("tel:+237677000001".replace("tel:", ""))).toBe("mtn");
  });

  it("rend inconnu plutot que de deviner", () => {
    expect(operateurProbable("")).toBe("inconnu");
    expect(operateurProbable("+33612345678")).toBe("inconnu");
    // Neuf chiffres, mais aucune plage connue.
    expect(operateurProbable("+237100000001")).toBe("inconnu");
  });
});

/* ═══════════════════════ lecture du corps ═══════════════════════ */

describe("lire la notification d'Orange", () => {
  it("lit la forme documentee", () => {
    expect(
      lireAccuse(notification("tel:+237677000001", "DeliveredToTerminal", "otp_connexion")),
    ).toEqual({
      numero: "+237677000001",
      statut: "DeliveredToTerminal",
      correlation: "otp_connexion",
    });
  });

  it("retire le prefixe tel:", () => {
    expect(lireAccuse(notification("tel:+237699000001", "MessageWaiting"))?.numero).toBe(
      "+237699000001",
    );
  });

  it("la correlation est facultative", () => {
    expect(lireAccuse(notification("tel:+237699000001", "MessageWaiting"))?.correlation).toBeNull();
  });

  /**
   * Tolerante par choix : la route repond 200 sur un corps illisible, donc
   * `lireAccuse` doit rendre `null` plutot que lever, sur n'importe quoi.
   */
  it("rend null sur tout ce qui n'est pas la forme attendue", () => {
    for (const mauvais of [
      null,
      undefined,
      "",
      42,
      {},
      { deliveryInfoNotification: null },
      { deliveryInfoNotification: {} },
      { deliveryInfoNotification: { deliveryInfo: {} } },
      { deliveryInfoNotification: { deliveryInfo: { address: "tel:+237677000001" } } },
      { deliveryInfoNotification: { deliveryInfo: { deliveryStatus: "DeliveredToTerminal" } } },
    ]) {
      expect(lireAccuse(mauvais)).toBeNull();
    }
  });
});

/* ═══════════════════════ la route ═══════════════════════ */

describe("POST /api/sms/accuse/:secret", () => {
  const app = new Hono().route("/api/sms", accuseLivraisonRoutes({ secret: SECRET }));

  const poster = (secret: string, corps: unknown) =>
    app.request(`/api/sms/accuse/${secret}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corps),
    });

  it("accepte un accuse valide", async () => {
    const r = await poster(SECRET, notification("tel:+237677000001", "DeliveredToTerminal"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ recu: true });
  });

  /**
   * Orange ne signe pas ses rappels : le secret du chemin est ce qui empeche un
   * tiers de fabriquer de fausses mesures de couverture.
   */
  it("refuse un secret faux, et rend la meme chose qu'un chemin inconnu", async () => {
    const faux = await poster(
      "pas-le-bon-secret-du-tout-32-ab",
      notification("tel:+237677000001", "DeliveredToTerminal"),
    );
    expect(faux.status).toBe(404);
    // Un secret de la BONNE longueur mais faux ne se distingue pas non plus.
    const memeLongueur = `${SECRET.slice(0, -1)}z`;
    expect((await poster(memeLongueur, {})).status).toBe(404);
  });

  /**
   * Orange attend un 200. Lui rendre une erreur sur un corps qu'on ne comprend
   * pas ne ferait revenir personne — l'accuse serait perdu de toute facon — et
   * ferait sonner une alarme chez l'operateur pour un defaut qui est le notre.
   */
  it("repond 200 meme sur un corps illisible", async () => {
    expect((await poster(SECRET, { nimporte: "quoi" })).status).toBe(200);
    const vide = await app.request(`/api/sms/accuse/${SECRET}`, { method: "POST" });
    expect(vide.status).toBe(200);
  });

  it("ne lit ni n'ecrit la base : la route se construit sans elle", () => {
    // Le test lui-meme le prouve — `accuseLivraisonRoutes` ne prend que le
    // secret. Ce qui suit verrouille l'intention contre une dependance ajoutee.
    expect(accuseLivraisonRoutes.length).toBe(1);
  });
});

/* ═══════════════════════ les gardes de bordure ═══════════════════════ */

describe("la route de rappel passe par les bons gardes", () => {
  /**
   * Machine a machine : aucun navigateur ne l'appelle. `fermee` empeche en plus
   * une page tierce d'aller y poster depuis le navigateur d'un visiteur.
   */
  it("n'ouvre aucun en-tete CORS", () => {
    expect(classeDuChemin("/api/sms/accuse/abc")).toBe("fermee");
  });

  /**
   * `lecture` et non `ecriture`, et le calcul se verifie : le plafond
   * journalier global d'OTP est de 2 000. Meme si les 2 000 accuses arrivaient
   * dans la meme heure, cela ferait 33 par minute — sous les 120 de `lecture`,
   * et douze fois au-dessus des 10 d'`ecriture`, qui les jetterait.
   */
  it("est limitee en debit, sous la famille lecture", () => {
    expect(familleDe("POST", "/api/sms/accuse/abc")).toBe("lecture");
  });
});
