import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "./_base.ts";
import { identifiants } from "./_identifiants.ts";
import { compteur } from "./harnais/couverture.ts";
import * as g from "./harnais/gestes.ts";
import { transcrire } from "./harnais/instantane.ts";
import { creerScene, pilote } from "./harnais/pilote.ts";

/**
 * Le PARCOURS VENDEUSE, joue de bout en bout par le harnais — audit de
 * pipeline, phase 3.
 *
 * Ces scenarios ne verifient pas une fonction : ils jouent des GESTES et
 * enregistrent ce que la vendeuse recoit. Ce qu'ils etablissent, aucune
 * assertion ciblee ne l'etablit — qu'a chaque etape, quelque chose est dit, et
 * que ce qui est dit designe le geste suivant.
 *
 * L'instantane est le livrable : une regression de copie s'y voit en diff.
 */

let prisma: PrismaClient;
const ids = identifiants("harnais-vendeuse");
const compte = compteur();

describeDb("parcours vendeuse — le harnais joue, on regarde", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("découverte → ouverture → premier article, question par question", async () => {
    /* Une PROSPECT : aucun compte, aucune boutique. `articles: 0` parce qu'elle
       n'en a pas encore — c'est elle qui va en creer un. */
    const scene = await creerScene(prisma, ids, { articles: 0 });
    /* On pilote un numero INCONNU du systeme, pas celui de la vendeuse de la
       scene : la scene sert de decor, la prospect arrive de l'exterieur. */
    const p = pilote(scene, scene.acheteuseWaId, { compteur: compte });

    const tours = await p.jouerTous([
      g.texteJuste("bonjour", "comprendre"),
      g.bouton("vendre"),
      g.texteJuste("Chez Solange"),
      g.texteJuste("Douala"),
      /* La relecture avant ouverture — ADR 0090. La boutique ne nait plus du
         second message : la vendeuse voit d'abord ce que le bot a retenu. */
      g.bouton("ouvrir"),
      g.ligneListe("article"),
      g.texteJuste("Pagne wax 6 yards"),
      g.texteJuste("15000"),
      g.bouton("sans_photo"),
    ]);

    /* L'instantane s'ecrit AVANT les assertions : on enregistre ce qui s'est
       passe, puis on juge. L'inverse perdrait la trace au premier echec —
       precisement l'information dont on a besoin pour comprendre. */
    await expect(transcrire("ouverture question par question", tours, scene)).toMatchFileSnapshot(
      "./harnais/instantanes/vendeuse-ouverture.txt",
    );

    /* Aucun tour muet : c'est la propriete que l'audit v1 n'a jamais mesuree. */
    const muets = tours.filter((t) => t.muet).map((t) => t.geste.libelle);
    expect(muets, "des gestes sont restés sans réponse").toEqual([]);

    /* La boutique existe VRAIMENT — le harnais lit la base, pas les messages. */
    const boutique = await prisma.seller.findFirst({
      where: { phone: `+${scene.acheteuseWaId}` },
      include: { products: true },
    });
    expect(boutique?.businessName).toBe("Chez Solange");
    expect(boutique?.city).toBe("Douala");
    expect(boutique?.products).toHaveLength(1);
    expect(boutique?.products[0]?.priceXaf).toBe(15000);
  });

  it("la photo légendée publie l'article d'un seul geste", async () => {
    const scene = await creerScene(prisma, ids, { articles: 0 });
    const p = pilote(scene, scene.vendeuseWaId, { compteur: compte });

    const tours = await p.jouerTous([g.photoLegendee("Sac à main 8000"), g.bouton("publier")]);

    expect(tours.filter((t) => t.muet)).toEqual([]);
    await expect(transcrire("photo légendée", tours, scene)).toMatchFileSnapshot(
      "./harnais/instantanes/vendeuse-photo-legendee.txt",
    );
  });
});

/**
 * Le test de NON-RETOUR du constat C-002 — audit du 13/08/2026, ADR 0090.
 *
 * Il aurait echoue avant le correctif : la boutique naissait du second message,
 * nom et slug PUBLIC figes, sans que la vendeuse ait rien relu.
 */
describeDb("C-002 — la boutique se relit avant de s'ouvrir", () => {
  it("rien n'est créé tant que la vendeuse n'a pas confirmé", async () => {
    const scene = await creerScene(prisma, ids, { articles: 0 });
    const p = pilote(scene, scene.acheteuseWaId, { compteur: compte });

    const tours = await p.jouerTous([
      g.bouton("vendre"),
      g.horsSujet("est-ce que vous vendez des chaussures pour bébé ?"),
      g.texteJuste("Douala"),
    ]);

    await expect(transcrire("relecture avant ouverture", tours, scene)).toMatchFileSnapshot(
      "./harnais/instantanes/vendeuse-relecture.txt",
    );

    /* AUCUNE boutique : c'est tout le constat C-002. */
    expect(await prisma.seller.count({ where: { phone: `+${scene.acheteuseWaId}` } })).toBe(0);
    const dernier = tours[tours.length - 1];
    expect(dernier?.etapeApres).toBe("inscription_confirme");
    /* Le nom est REPETE, et la phrase dit qu'il deviendra l'adresse publique. */
    const dit = JSON.stringify(dernier?.messages);
    expect(dit).toContain("chaussures pour b");
    expect(dit).toContain("adresse");
  });

  it("« Corriger » repose la question, et le nom repris est celui qui s'ouvre", async () => {
    const scene = await creerScene(prisma, ids, { articles: 0 });
    const p = pilote(scene, scene.acheteuseWaId, { compteur: compte });

    await p.jouerTous([
      g.bouton("vendre"),
      g.horsSujet("est-ce que vous vendez des chaussures pour bébé ?"),
      g.texteJuste("Douala"),
      g.bouton("corriger"),
      g.texteJuste("Chez Solange"),
      g.texteJuste("Douala"),
      g.bouton("ouvrir"),
    ]);

    const v = await prisma.seller.findFirst({ where: { phone: `+${scene.acheteuseWaId}` } });
    expect(v?.businessName).toBe("Chez Solange");
    expect(v?.slug).not.toContain("chaussures");
  });
});
