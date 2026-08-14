import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compteur, ETAPES, mesureComplete, type Rapport } from "./harnais/couverture.ts";
import { FAMILLES } from "./harnais/gestes.ts";
import { poserInstantanes } from "./harnais/poser.ts";

/**
 * La GARDE des instantanes du balayage — defaut du 14/08.
 *
 * Ce fichier ne touche ni la base ni le reseau : il verifie une regle
 * d'ecriture, et il doit tourner meme quand `DATABASE_URL` est absente — c'est
 * precisement l'execution degradee qui a casse les instantanes.
 *
 * Ce qu'il tient : une mesure partielle n'ecrase pas une mesure entiere. Sans
 * lui, la regle ne vivrait que dans l'ordre des lignes de
 * `harnais-balayage.test.ts`, c'est-a-dire nulle part.
 */

/** Un rapport complet : toutes les cases du catalogue notees. */
function rapportComplet(): Rapport {
  const c = compteur();
  for (const e of ETAPES) for (const f of FAMILLES) c.noter(e.cle, f);
  return c.rapport();
}

/** Un rapport partiel : le balayage s'est arrete apres une seule etape. */
function rapportPartiel(): Rapport {
  const c = compteur();
  const premiere = ETAPES[0];
  if (!premiere) throw new Error("le catalogue d'étapes est vide");
  for (const f of FAMILLES) c.noter(premiere.cle, f);
  return c.rapport();
}

/** Un rapport vide : aucune case jouee — l'execution du 14/08. */
function rapportVide(): Rapport {
  return compteur().rapport();
}

const TROIS = [
  { nom: "a.md", contenu: "nouveau A" },
  { nom: "b.md", contenu: "nouveau B" },
  { nom: "c.md", contenu: "nouveau C" },
];

const AVANT = "la mesure du dernier balayage complet";

describe("les instantanés du balayage ne s'écrivent que depuis une mesure complète", () => {
  let sortie: string;

  beforeEach(() => {
    sortie = mkdtempSync(join(tmpdir(), "catalog-instantanes-"));
    for (const f of TROIS) writeFileSync(join(sortie, f.nom), AVANT, "utf8");
  });
  afterEach(() => {
    rmSync(sortie, { recursive: true, force: true });
  });

  const lire = (nom: string) => readFileSync(join(sortie, nom), "utf8");

  it("une mesure complète écrit les trois fichiers", () => {
    poserInstantanes(sortie, rapportComplet(), TROIS);
    expect(TROIS.map((f) => lire(f.nom))).toEqual(["nouveau A", "nouveau B", "nouveau C"]);
  });

  it("LE défaut du 14/08 : une mesure vide n'écrase rien", () => {
    /* `DATABASE_URL` posee mais inutilisable — les 22 etapes echouent, `jouees`
       reste vide. L'ancien code ecrivait quand meme, puis echouait : un tableau
       a 0 % remplacait 534 lignes de mesure. */
    expect(() => poserInstantanes(sortie, rapportVide(), TROIS)).toThrow(/Balayage incomplet/);
    expect(TROIS.map((f) => lire(f.nom))).toEqual([AVANT, AVANT, AVANT]);
  });

  it("une mesure partielle n'écrase rien non plus", () => {
    expect(() => poserInstantanes(sortie, rapportPartiel(), TROIS)).toThrow(/Balayage incomplet/);
    expect(TROIS.map((f) => lire(f.nom))).toEqual([AVANT, AVANT, AVANT]);
  });

  it("tout ou rien : un refus ne laisse pas un fichier neuf à côté de deux anciens", () => {
    /* Trois fichiers qui se lisent ensemble ne doivent pas pouvoir dater de
       deux balayages differents. La boucle d'ecriture est donc APRES le refus,
       jamais entrelacee avec lui. */
    expect(() => poserInstantanes(sortie, rapportPartiel(), TROIS)).toThrow();
    expect(new Set(TROIS.map((f) => lire(f.nom))).size, "les trois fichiers ont divergé").toBe(1);
  });

  it("le message dit ce qui manque ET ce qui n'a pas été écrit", () => {
    /* Sans la seconde moitie, on croirait lire l'etat du disque. */
    let message = "";
    try {
      poserInstantanes(sortie, rapportVide(), TROIS);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("couverture 0 %");
    expect(message).toContain("a.md, b.md, c.md");
    expect(message).toContain("Aucun instantané n'a été écrit");
  });

  it("une étape hors catalogue est un trou, même à 100 % sur les étapes connues", () => {
    /* `pourcentageGlobal` ne compte que les etapes CONNUES : il peut valoir 100
       pendant qu'une case a ete jouee sous une etape que `couverture.ts`
       ignore. Le tableau aurait alors un trou qui ne se voit pas. */
    const uneFamille = FAMILLES[0];
    if (!uneFamille) throw new Error("le vocabulaire de gestes est vide");
    const c = compteur();
    for (const e of ETAPES) for (const f of FAMILLES) c.noter(e.cle, f);
    c.noter("etat_que_personne_n_a_declare", uneFamille);
    const r = c.rapport();

    expect(r.pourcentageGlobal, "les étapes connues sont bien toutes couvertes").toBe(100);
    expect(mesureComplete(r), "et pourtant la mesure n'est pas complète").toBe(false);
    expect(() => poserInstantanes(sortie, r, TROIS)).toThrow(/étapes hors catalogue/);
    expect(TROIS.map((f) => lire(f.nom))).toEqual([AVANT, AVANT, AVANT]);
  });
});
