import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_ALPHABET } from "@catalog/contracts";
import { describe, expect, it } from "vitest";
import { BLOCS, type Fichier, identifiants, selExecution, VARIABLE_SEL } from "./_identifiants.ts";

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

  it("un code de verification a la forme que la contrainte SQL exige", () => {
    expect(i.codeVerification()).toMatch(
      new RegExp(`^[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{4}$`),
    );
  });

  it("le code de verification est INJECTIF — deux appels, deux codes", () => {
    /* Ce qui manquait, et qui a fait rougir la CI le 12/08 sur `RYEC-6XVX`.
       Les fichiers se recopiaient un `codeDeTest(graine)` qui HACHE
       (`n * 31 + 17` modulo 1 000 003) : le bloc separe les nombres, il ne
       separe pas ce qu'un hachage en fait — et les nombres d'ici depassent le
       module, donc ils retombaient dans la plage des autres fichiers.

       Ici c'est un changement de base, pas un hachage. La propriete se
       demontre au lieu de s'esperer. */
    const j = identifiants("bot-comptoir");
    const vus = new Set<string>();
    for (let n = 0; n < 99; n++) vus.add(j.codeVerification());
    expect(vus.size).toBe(99);
  });

  it("deux FICHIERS ne peuvent pas produire le meme code", () => {
    const a = identifiants("attaques-preuve", 500);
    const b = identifiants("recu-route", 500);
    const ceuxDeA = new Set(Array.from({ length: 99 }, () => a.codeVerification()));
    for (let n = 0; n < 99; n++) expect(ceuxDeA.has(b.codeVerification())).toBe(false);
  });

  it("deux EXECUTIONS non plus", () => {
    const a = identifiants("recu-route", 41);
    const b = identifiants("recu-route", 42);
    const ceuxDeA = new Set(Array.from({ length: 99 }, () => a.codeVerification()));
    for (let n = 0; n < 99; n++) expect(ceuxDeA.has(b.codeVerification())).toBe(false);
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
    /* La borne du schema, dite ici plutot que supposee. Tant que le sel etait
       tire de l'horloge, c'etait une chance sur mille PAR PAIRE d'executions —
       et la CI en fabrique une paire a chaque passage. Le sel se pose
       maintenant : cette borne n'est plus atteinte par accident, seulement par
       une CI qui poserait deux fois la meme valeur. */
    expect(tous(742)).toEqual(tous(742));
  });

  it("aucun sel ne fait deborder la tranche du fichier suivant", () => {
    /* La tranche vaut 100 000. Sel maximal et compteur maximal doivent y tenir,
       sinon le fichier de bloc 13 recevrait les identifiants de celui de 12. */
    const dernier = Math.max(...tous(999));
    expect(dernier).toBeLessThan((BLOCS["recu-route"] + 1) * 100_000);
  });
});

describe("le sel d'une execution se POSE — la propriete du 12/08", () => {
  /** Rend l'environnement tel qu'il etait : un test ne laisse pas de trace. */
  const avec = <T>(valeur: string | undefined, f: () => T): T => {
    const initial = process.env[VARIABLE_SEL];
    if (valeur === undefined) delete process.env[VARIABLE_SEL];
    else process.env[VARIABLE_SEL] = valeur;
    try {
      return f();
    } finally {
      if (initial === undefined) delete process.env[VARIABLE_SEL];
      else process.env[VARIABLE_SEL] = initial;
    }
  };

  it("pose, il est rendu tel quel tant qu'il tient en trois chiffres", () => {
    expect(avec("7", selExecution)).toBe(7);
    expect(avec("0", selExecution)).toBe(0);
    expect(avec("999", selExecution)).toBe(999);
  });

  it("un identifiant de passage, long, est ramene modulo mille", () => {
    /* La CI ne pose pas une constante : elle pose `${github.run_id}` suffixe
       par l'etape. Une constante separerait les deux etapes d'un passage et
       recouvrirait ENTIEREMENT le passage precedent si la base lui survivait —
       mesure du 12/08, quatorze fichiers rouges d'un coup. */
    expect(avec("31596481184", selExecution)).toBe(184);
  });

  it("les deux etapes d'un MEME passage different toujours", () => {
    /* La propriete que la CI achete : suffixe `0` et suffixe `1` sur le meme
       `run_id` donnent deux sels voisins, donc deux tranches disjointes. */
    for (const passage of ["31596481184", "1", "999999999999", "7"]) {
      const a = avec(`${passage}0`, selExecution);
      const b = avec(`${passage}1`, selExecution);
      expect(b - a, passage).toBe(1);
    }
  });

  it("deux PASSAGES differents ne posent pas le meme sel", () => {
    /* Ce que la constante ne donnait pas. Deux passages consecutifs de la CI
       ont des `run_id` distincts, donc des sels distincts, meme si la base
       survivait de l'un a l'autre. */
    const a = avec("315964811840", selExecution);
    const b = avec("315964811850", selExecution);
    expect(a).not.toBe(b);
  });

  it("absent, il retombe sur l'horloge", () => {
    /* Le developpement local : base jetable, une exécution a la fois, le
       tirage suffit. La CI, elle, pose. */
    const n = avec(undefined, selExecution);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(999);
  });

  it('VIDE, il LEVE — parce que `Number("")` vaut zero', () => {
    /* La meme arete qu'au lot 8 (ADR 0019), ou un montant fait uniquement de
       separateurs produisait un paiement de zero franc parfaitement forme. Ici
       elle donnerait le sel 0 en silence, donc deux executions identiques —
       precisement le defaut que ce schema ferme. Un repli silencieux serait
       PIRE que le defaut : la CI redeviendrait intermittente sans que rien ne
       le dise. */
    expect(Number("")).toBe(0); // l'arete elle-meme, pour qu'elle soit lisible
    expect(() => avec("", selExecution)).toThrow(/entier positif/);
    expect(() => avec("   ", selExecution)).toThrow(/entier positif/);
  });

  it("mal forme, il LEVE aussi", () => {
    /* `1000` n'est PAS dans cette liste : la borne porte sur ce qu'on garde du
       nombre, pas sur ce qu'on accepte — sinon la CI ne pourrait pas poser un
       identifiant de passage. */
    for (const mauvais of ["-1", "7.5", "sept", "12a", "1e2", " 12 3", "+7"]) {
      expect(() => avec(mauvais, selExecution), mauvais).toThrow(/entier positif/);
    }
  });

  it("AUCUN fichier de test ne HACHE son code de verification", () => {
    /* La lecon de l'ADR 0078, generalisee (tache #68). Neuf fichiers se
       recopiaient un generateur qui HACHAIT sa graine (`n * 31 + 17` modulo
       1000003) : le bloc separe les NOMBRES, il ne separe pas ce qu'un
       hachage en fait — vu en CI le 12/08 sur `RYEC-6XVX`. Les codes viennent
       desormais de `codeVerification()`, dont l'encodage est INJECTIF et
       demontre plus haut.

       Le garde vise les deux traces du defaut : le nom des generateurs
       recopies, et le module du hachage — l'un des deux survit a toute
       reecriture partielle. */
    const coupables = readdirSync(ICI)
      .filter((f) => f.endsWith(".ts") && f !== "_identifiants.ts")
      .filter((f) => {
        const source = readFileSync(join(ICI, f), "utf8");
        /* L'aiguille du module se CONSTRUIT au lieu de s'ecrire : ecrite en
           clair, ce fichier se denoncait lui-meme — la meme mesaventure que le
           garde du sel, resolue de la meme facon. */
        const module = ["1", "000", "003"].join("_");
        return /function code(?:DeTest|Unique)\b/.test(source) || source.includes(module);
      });
    expect(coupables).toEqual([]);
  });

  it("AUCUN fichier de test ne tire son propre sel de l'horloge", () => {
    /* LE test de ce lot. Le bloc separe les FICHIERS ; il ne separe pas les
       EXECUTIONS. Un fichier qui refabrique son sel a partir de l'horloge,
       modulo ce qu'on voudra, se redonne le droit de tomber sur celui du
       voisin — et il le fera une fois sur mille, c'est-a-dire assez rarement
       pour que le rouge passe pour un defaut metier, et assez souvent pour
       empoisonner la CI.

       La liste des exceptions est vide et doit le rester : `_identifiants.ts`
       est le seul endroit ou l'horloge a le droit d'entrer. Ce test s'est
       d'abord denonce lui-meme, parce que ce commentaire citait le motif ; on
       l'a reformule plutot que d'ouvrir une exception, car une liste
       d'exceptions est la porte par laquelle le defaut revient. */
    const coupables = readdirSync(ICI)
      .filter((f) => f.endsWith(".ts") && f !== "_identifiants.ts")
      .filter((f) => /Date\.now\(\)\s*%/.test(readFileSync(join(ICI, f), "utf8")));
    expect(coupables).toEqual([]);
  });
});
