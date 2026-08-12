import { describe, expect, it } from "vitest";
import {
  autorise,
  COHORTE_OUVERTE,
  MESSAGE_INTERRUPTEUR,
  ouvertePour,
  positionDepuis,
  seauDe,
} from "../domain/deploiement/ouverture.ts";

/**
 * L'ouverture progressive et l'interrupteur d'arret.
 *
 * Le test central est celui de la MONOTONIE : elargir une cohorte ne doit
 * jamais refermer la porte a quelqu'un qui l'avait franchie. C'est la propriete
 * qui rend l'ouverture par vagues supportable pour les vendeuses, et c'est
 * exactement celle qu'un tirage au sort n'aurait pas.
 */

const ids = Array.from({ length: 500 }, (_, i) => `seller_${i.toString(36)}_${i * 7919}`);

describe("cohortes", () => {
  it("le seau est stable et tient dans 0..99", () => {
    for (const id of ids.slice(0, 50)) {
      const s = seauDe(id);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(100);
      // Deux appels, meme reponse : sans cela, un redemarrage rebattrait les
      // cartes et une vendeuse admise hier serait dehors ce matin.
      expect(seauDe(id)).toBe(s);
    }
  });

  it("la chaine vide a un seau defini", () => {
    expect(seauDe("")).toBeGreaterThanOrEqual(0);
  });

  /**
   * **La propriete qui justifie le hachage.** Aucun identifiant ne doit sortir
   * de la cohorte quand le pourcentage monte.
   */
  it("elargir n'exclut jamais : la cohorte est monotone", () => {
    for (let p = 0; p < 100; p += 1) {
      const dedans = ids.filter((id) => ouvertePour(id, { pourcent: p, pilotes: [] }));
      const dedansApres = new Set(
        ids.filter((id) => ouvertePour(id, { pourcent: p + 1, pilotes: [] })),
      );
      for (const id of dedans) expect(dedansApres.has(id)).toBe(true);
    }
  });

  it("0 % ferme a tout le monde, 100 % ouvre a tout le monde", () => {
    expect(ids.some((id) => ouvertePour(id, { pourcent: 0, pilotes: [] }))).toBe(false);
    expect(ids.every((id) => ouvertePour(id, { pourcent: 100, pilotes: [] }))).toBe(true);
    expect(ids.every((id) => ouvertePour(id, COHORTE_OUVERTE))).toBe(true);
  });

  it("une valeur hors bornes est ramenee dans l'intervalle, pas refusee", () => {
    // Un `-5` saisi en urgence doit fermer, pas faire tomber le service.
    expect(ouvertePour(ids[0] as string, { pourcent: -5, pilotes: [] })).toBe(false);
    expect(ouvertePour(ids[0] as string, { pourcent: 500, pilotes: [] })).toBe(true);
    expect(ouvertePour(ids[0] as string, { pourcent: 12.9, pilotes: [] })).toBe(
      seauDe(ids[0] as string) < 12,
    );
  });

  it("la liste des pilotes passe avant le pourcentage", () => {
    const dehors = ids.find((id) => !ouvertePour(id, { pourcent: 10, pilotes: [] })) as string;
    expect(ouvertePour(dehors, { pourcent: 10, pilotes: [dehors] })).toBe(true);
    // Et meme a 0 % : c'est par cette liste qu'entrent les vendeuses du terrain.
    expect(ouvertePour(dehors, { pourcent: 0, pilotes: [dehors] })).toBe(true);
  });

  it("la repartition est assez uniforme pour que le pourcentage veuille dire quelque chose", () => {
    const dedans = ids.filter((id) => ouvertePour(id, { pourcent: 50, pilotes: [] })).length;
    const part = dedans / ids.length;
    // Une tolerance large : ce hachage repartit, il ne fait pas de statistique.
    expect(part).toBeGreaterThan(0.35);
    expect(part).toBeLessThan(0.65);
  });
});

describe("interrupteur d'arret", () => {
  it("lit les trois positions", () => {
    expect(positionDepuis("ouvert")).toBe("ouvert");
    expect(positionDepuis("lecture_seule")).toBe("lecture_seule");
    expect(positionDepuis(" FERME ")).toBe("ferme");
  });

  /**
   * **Une faute de frappe n'arrete pas le service.** Le reflexe « en cas de
   * doute, on ferme » serait un defaut ici : `INTERRUPTEUR="lecture-seule"`
   * mettrait Catalog a l'arret sans que personne l'ait decide. L'arret est un
   * acte deliberé, il s'ecrit exactement.
   */
  it("une valeur inconnue ou absente laisse le service ouvert", () => {
    expect(positionDepuis(undefined)).toBe("ouvert");
    expect(positionDepuis("")).toBe("ouvert");
    expect(positionDepuis("lecture-seule")).toBe("ouvert");
    expect(positionDepuis("arret")).toBe("ouvert");
  });

  it("ouvert laisse tout passer", () => {
    expect(autorise("ouvert", "lecture")).toBe(true);
    expect(autorise("ouvert", "ecriture")).toBe(true);
    expect(autorise("ouvert", "diagnostic")).toBe(true);
  });

  /**
   * **Le recu survit a la panne.** C'est la raison d'etre de la position
   * intermediaire : un recu est une preuve opposable, et faire disparaitre les
   * preuves deja emises le jour d'un incident technique en ferait un incident de
   * confiance.
   */
  it("lecture_seule coupe les ecritures et garde les lectures", () => {
    expect(autorise("lecture_seule", "lecture")).toBe(true);
    expect(autorise("lecture_seule", "ecriture")).toBe(false);
  });

  it("ferme coupe tout sauf le diagnostic", () => {
    expect(autorise("ferme", "lecture")).toBe(false);
    expect(autorise("ferme", "ecriture")).toBe(false);
    // Sans cette exception, la page de statut publique tomberait avec le reste —
    // c'est-a-dire au moment precis ou on la regarde.
    expect(autorise("ferme", "diagnostic")).toBe(true);
  });

  it("chaque position fermee porte un message qui dit ce qui marche encore", () => {
    expect(MESSAGE_INTERRUPTEUR.lecture_seule.message).toMatch(/reçus/i);
    expect(MESSAGE_INTERRUPTEUR.ferme.message).toMatch(/perdue/i);
  });
});
