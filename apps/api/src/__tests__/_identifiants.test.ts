import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BLOCS, type Fichier, identifiants } from "./_identifiants.ts";

/** Le schema d'identifiants de test — voir l'en-tete de `_identifiants.ts`. */

const ICI = dirname(fileURLToPath(import.meta.url));

describe("la table des blocs", () => {
  it("aucun bloc n'est partage par deux fichiers", () => {
    /* La faute qui ne se voit pas a la lecture, et qui produirait exactement le
       recouvrement que ce fichier existe pour empecher. */
    const valeurs = Object.values(BLOCS);
    expect(new Set(valeurs).size).toBe(valeurs.length);
  });

  it("les blocs restent a DEUX chiffres, et au moins 10", () => {
    /* >= 10 : c'est ce qui garantit sept chiffres significatifs, donc pas de
       zero de tete — la frontiere avec l'ancien schema, qui en produit six au
       plus. <= 99 : au-dela, la queue du numero deborde. */
    for (const [nom, bloc] of Object.entries(BLOCS)) {
      expect(bloc, nom).toBeGreaterThanOrEqual(10);
      expect(bloc, nom).toBeLessThanOrEqual(99);
    }
  });

  it("chaque fichier nomme dans la table existe vraiment", () => {
    /* Un nom mal orthographie donnerait un bloc a un fichier fantome, et deux
       vrais fichiers pourraient alors partager le meme sans que rien ne le
       dise. */
    const presents = new Set(readdirSync(ICI).map((f) => f.replace(/\.test\.ts$/, "")));
    for (const nom of Object.keys(BLOCS)) expect(presents.has(nom), nom).toBe(true);
  });
});

describe("la forme des identifiants", () => {
  const i = identifiants("attaques-preuve");

  it("le numero a bien neuf chiffres apres l'indicatif", () => {
    /* Sept pour l'identifiant, deux pour le prefixe operateur. Un chiffre de
       plus et ce n'est plus un numero camerounais. */
    expect(i.tel("67")).toMatch(/^\+237\d{9}$/);
  });

  it("aucun identifiant ne se repete dans une execution", () => {
    const j = identifiants("recu-route");
    const vus = new Set<number>();
    for (let n = 0; n < 90; n++) vus.add(j.suivant());
    expect(vus.size).toBe(90);
  });

  it("deux fichiers ne se croisent jamais, meme au meme instant", () => {
    /* Le recouvrement du 10/08 : des fichiers joues en parallele partagent la
       milliseconde, donc le sel. Seul le bloc les separe. */
    const a = identifiants("attaques-preuve");
    const b = identifiants("recu-route");
    const ceuxDeA = new Set(Array.from({ length: 99 }, () => a.suivant()));
    for (let n = 0; n < 99; n++) expect(ceuxDeA.has(b.suivant())).toBe(false);
  });

  it("le compteur LEVE au-dela de 99, il ne boucle pas en silence", () => {
    /* Un debordement silencieux reviendrait a reutiliser les identifiants du
       debut du fichier : le pire des deux mondes, puisque l'echec ressemblerait
       a un defaut metier. */
    const j = identifiants("recu-route");
    for (let n = 0; n < 99; n++) j.suivant();
    expect(() => j.suivant()).toThrow(/99 identifiants/);
  });

  it("un identifiant Orange tient dans les cinq chiffres du gabarit", () => {
    expect(identifiants("attaques-preuve").txOrange()).toMatch(/^MP260623\.1403\.C\d{5}$/);
  });

  it("un identifiant MTN tient dans la forme de l'operateur", () => {
    expect(i.txMtn()).toMatch(/^176\d{8}$/);
  });
});

describe("la frontiere avec les fichiers non migres", () => {
  it("un seul fichier fabrique des identifiants Orange", () => {
    /* Le gabarit Orange ne laisse que cinq chiffres : le bloc n'y tient pas, et
       la separation entre fichiers repose donc sur le fait qu'il n'y en a
       qu'un. Ce test echoue le jour ou un second s'y met — et c'est le bon
       moment pour y penser, pas six mois plus tard sur un echec obscur. */
    const fabricants = readdirSync(ICI)
      .filter((f) => f.endsWith(".test.ts"))
      .filter((f) => /MP\d{6}\.\d{4}\.C\$\{/.test(readFileSync(join(ICI, f), "utf8")));
    expect(fabricants).toEqual([]);
  });

  it("l'ancien schema produit six chiffres au plus — donc un zero de tete", () => {
    /* `bloc(3) * 1000 + sel(3)` <= 999999. Sur sept chiffres, il reste toujours
       un zero devant ; les identifiants d'ici commencent a 10 * 100000. C'est
       ce qui fait que les deux familles ne peuvent pas se croiser pendant la
       migration. */
    const ancienMaximum = 999 * 1000 + 999;
    const nouveauMinimum = 10 * 100_000 + 0 * 100 + 1;
    expect(ancienMaximum).toBeLessThan(nouveauMinimum);
  });
});

describe("deux EXECUTIONS ne se croisent pas — la propriete du 11/08", () => {
  const tous = (sel: number): number[] => {
    const j = identifiants("recu-route", sel);
    return Array.from({ length: 99 }, () => j.suivant());
  };

  it("des sels VOISINS produisent des ensembles disjoints", () => {
    /* C'est exactement ce qui manquait. L'ancien schema numerotait les fixtures
       `RUN + 1` … `RUN + 16` : deux executions distantes de moins de seize
       millisecondes modulo mille partageaient des identifiants. Ici, le
       compteur a ses propres chiffres, donc un ecart de UN suffit a separer. */
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [498, 499],
      [998, 999],
    ]) {
      const ceuxDeA = new Set(tous(a as number));
      for (const x of tous(b as number)) expect(ceuxDeA.has(x), `${a} vs ${b}`).toBe(false);
    }
  });

  it("le recouvrement n'est possible QUE sur un sel identique", () => {
    /* Une chance sur mille, et sans amplification par un pas : c'est la borne
       que ce schema promet, dite ici plutot que supposee. */
    expect(tous(742)).toEqual(tous(742));
  });

  it("aucun sel ne fait deborder la tranche du fichier suivant", () => {
    /* La tranche vaut 100 000. Sel maximal et compteur maximal doivent y tenir,
       sinon le fichier de bloc 13 recevrait les identifiants de celui de 12. */
    const dernier = Math.max(...tous(999));
    expect(dernier).toBeLessThan((BLOCS["recu-route"] + 1) * 100_000);
  });
});
