import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAMPS_FLUX } from "../domain/bot/flux.ts";

/**
 * La definition deposee chez Meta et le code ne peuvent pas diverger —
 * ADR 0055.
 *
 * Les noms de champs sont le CONTRAT entre les deux. Les changer d'un cote
 * casse la lecture de l'autre EN SILENCE : la reponse arrive, aucun champ ne
 * correspond, et `lireReponseFlux` rend `null` sans que rien ne dise pourquoi.
 */
describe("la spec du Flow suit le code", () => {
  const spec = JSON.parse(
    readFileSync(new URL("../../../../docs/flux-livraison.json", import.meta.url), "utf8"),
  ) as {
    screens: Array<{ layout: { children: Array<{ children: Array<Record<string, unknown>> }> } }>;
  };

  /* Un seul ecran, un seul formulaire : si la spec change de forme, ces
     lectures echouent bruyamment plutot que de rendre une liste vide qui
     ferait passer le test pour de mauvaises raisons. */
  const ecran = spec.screens[0];
  if (!ecran) throw new Error("la spec du Flow n'a aucun ecran");
  const formulaire = ecran.layout.children[0];
  if (!formulaire) throw new Error("l'ecran du Flow n'a aucun formulaire");
  /* TOUS les champs nommes, quel que soit leur type : depuis l'addendum de
     l'ADR 0063, le formulaire porte aussi une case a cocher (`OptIn`). Ne
     regarder que les `TextInput` laisserait un champ hors du contrat. */
  const champs = formulaire.children.filter((c) => c.name).map((c) => c.name as string);
  const saisies = formulaire.children.filter((c) => c.type === "TextInput");

  it("declare EXACTEMENT les champs que le code lit", () => {
    expect(champs.sort()).toEqual(Object.values(CHAMPS_FLUX).sort());
  });

  it("rend obligatoire tout ce qui remplace l'adresse — une livraison partielle n'est pas livrable", () => {
    /* Les quatre saisies, et elles seules : ville, quartier, repere, telephone. */
    expect(saisies.map((c) => c.name).sort()).toEqual(
      ["quartier", "repere", "telephone", "ville"].sort(),
    );
    for (const c of saisies) expect(c.required, c.name as string).toBe(true);
  });

  it("la position reste FACULTATIVE, et c'est structurel", () => {
    /* Meta n'a pas de composant de carte (mesure du 11/08/2026) : cette case
       porte une intention, la capture se fait par le message natif. La rendre
       obligatoire bloquerait la commande de celles dont le GPS est coupe —
       or c'est le REPERE qui livre au Cameroun, pas le point (ADR 0005). */
    const position = formulaire.children.find((c) => c.name === CHAMPS_FLUX.position);
    expect(position?.type).toBe("OptIn");
    expect(position?.required).not.toBe(true);
  });

  it("aucun champ ne s'appelle « adresse » — AGENTS.md §2", () => {
    /* Le MOT peut apparaitre dans un texte d'aide (« c'est ce qui remplace
       l'adresse »), et c'est meme la bonne formulation : l'interdit porte sur
       un CHAMP, pas sur le vocabulaire. */
    for (const c of champs) expect(c).not.toMatch(/adresse|address/i);
  });
});
