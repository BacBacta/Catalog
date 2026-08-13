import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { identifiants } from "./_identifiants.ts";
import { compteur } from "./harnais/couverture.ts";
import * as g from "./harnais/gestes.ts";
import { transcrire } from "./harnais/instantane.ts";
import { creerScene, pilote } from "./harnais/pilote.ts";

/**
 * Le PARCOURS ACHETEUSE, joue de bout en bout — audit de pipeline, phase 3.
 *
 * A severite egale, ce parcours prime sur celui de la vendeuse (§6 du prompt
 * d'audit) : l'acheteuse n'a aucune raison de perseverer. Elle n'a rien
 * installe, rien signe, et un fil qui la laisse dans le vague se referme sans
 * qu'on l'apprenne jamais.
 *
 * Les instantanes sont le livrable : une regression de copie s'y voit en diff.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const ids = identifiants("harnais-acheteuse");
const compte = compteur();

describeDb("parcours acheteuse — le harnais joue, on regarde", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("arrivée par le lien → article → quantité → panier → livraison → commande", async () => {
    const scene = await creerScene(prisma, ids, { articles: 2 });
    const a = pilote(scene, scene.acheteuseWaId, { compteur: compte });
    const premier = scene.articles[0]?.id ?? "a1";

    const tours = await a.jouerTous([
      /* Le lien `wa.me` pre-rempli — la porte d'entree reelle du produit. */
      g.texteJuste(`boutique ${scene.slug}`, "comprendre"),
      g.ligneListe(`art:${premier}`),
      g.bouton(`cmd:${premier}`),
      g.ligneListe("qte:2"),
      g.bouton("commander"),
      g.bouton("mode:livraison"),
      g.texteJuste("Bafoussam"),
      g.texteJuste("Bonapriso, en face de la pharmacie Bleue, 690112233"),
      g.bouton("confirmer"),
    ]);

    await expect(transcrire("commande complète", tours, scene)).toMatchFileSnapshot(
      "./harnais/instantanes/acheteuse-commande.txt",
    );

    expect(tours.filter((t) => t.muet).map((t) => t.geste.libelle)).toEqual([]);

    /* La commande existe VRAIMENT, et son argent est juste. */
    const commande = await prisma.order.findFirst({
      where: { sellerId: scene.sellerId },
      include: { events: true },
    });
    expect(commande, "aucune commande créée").toBeTruthy();
    /* 15 000 × 2 = 30 000, en ENTIERS — AGENTS.md §2. */
    expect(commande?.totalXaf).toBe(30000);
    expect(Number.isInteger(commande?.totalXaf)).toBe(true);
    /* L'invariant de la base : payé + solde = total. */
    expect((commande?.amountPaidXaf ?? 0) + (commande?.balanceXaf ?? 0)).toBe(commande?.totalXaf);
    /* La ville est celle de la LIVRAISON, pas celle de la boutique — ADR 0050. */
    expect(commande?.delivery).toMatchObject({ mode: "livraison", city: "Bafoussam" });
    /* Aucun champ `address` — ADR 0005. */
    expect(Object.keys(commande?.delivery as object)).not.toContain("address");
  });

  it("le tunnel garde ses sorties : « annuler » sort, et le dit", async () => {
    const scene = await creerScene(prisma, ids, { articles: 2 });
    const a = pilote(scene, scene.acheteuseWaId, { compteur: compte });
    const premier = scene.articles[0]?.id ?? "a1";

    const tours = await a.jouerTous([
      g.texteJuste(`boutique ${scene.slug}`, "comprendre"),
      g.bouton(`cmd:${premier}`),
      g.ligneListe("qte:1"),
      g.abandon("annuler"),
    ]);

    await expect(transcrire("abandon du tunnel", tours, scene)).toMatchFileSnapshot(
      "./harnais/instantanes/acheteuse-abandon.txt",
    );
    expect(tours.filter((t) => t.muet)).toEqual([]);
    /* Rien n'a ete cree : un abandon ne laisse pas de commande fantome. */
    expect(await prisma.order.count({ where: { sellerId: scene.sellerId } })).toBe(0);
  });

  it("boutique en congés : la commande est refusée, et la raison est dite", async () => {
    /* ADR 0039 — le verrou qui compte est dans le service, a la creation. */
    const scene = await creerScene(prisma, ids, { articles: 2, enConges: true });
    const a = pilote(scene, scene.acheteuseWaId, { compteur: compte });
    const premier = scene.articles[0]?.id ?? "a1";

    const tours = await a.jouerTous([
      g.texteJuste(`boutique ${scene.slug}`, "comprendre"),
      g.bouton(`cmd:${premier}`),
      g.ligneListe("qte:1"),
      g.bouton("commander"),
      g.bouton("mode:retrait"),
      g.texteJuste("Carrefour Warda, 690112233"),
      g.bouton("confirmer"),
    ]);

    await expect(transcrire("boutique en congés", tours, scene)).toMatchFileSnapshot(
      "./harnais/instantanes/acheteuse-conges.txt",
    );
    expect(tours.filter((t) => t.muet)).toEqual([]);
    /* Le verrou tient : aucune commande, malgre un tunnel mene jusqu'au bout. */
    expect(await prisma.order.count({ where: { sellerId: scene.sellerId } })).toBe(0);
  });

  it("reprise après 25 h : l'état périme, et le fil ne repart pas dans le vide", async () => {
    /* ADR 0032/0048 — `INACTIVITE_MAX_MS` vaut 24 h. On tombe de l'autre cote. */
    const scene = await creerScene(prisma, ids, { articles: 2 });
    const a = pilote(scene, scene.acheteuseWaId, { compteur: compte });
    const premier = scene.articles[0]?.id ?? "a1";

    const tours = await a.jouerTous([
      g.texteJuste(`boutique ${scene.slug}`, "comprendre"),
      g.bouton(`cmd:${premier}`),
      g.ligneListe("qte:1"),
      g.bouton("commander"),
      g.bouton("mode:livraison"),
      /* Elle part. Et elle revient le lendemain, apres la fenetre. */
      g.reprise25h("bonjour"),
    ]);

    await expect(transcrire("reprise après 25 h", tours, scene)).toMatchFileSnapshot(
      "./harnais/instantanes/acheteuse-reprise-25h.txt",
    );
    expect(tours.filter((t) => t.muet)).toEqual([]);
    /* Le panier de la veille ne ressuscite pas en silence : l'etat retombe sur
       le catalogue de la MEME boutique — elle n'est pas renvoyee nulle part. */
    const dernier = tours[tours.length - 1];
    expect(dernier?.etapeApres).toBe("catalogue");
  });
});
