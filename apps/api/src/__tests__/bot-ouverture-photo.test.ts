import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import { jetonFlux } from "../domain/bot/flux.ts";
import type { LecteurMedia, MediaEntrant, PhotoCdnChiffree } from "../domain/bot/media.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * La photo du formulaire d'ouverture, et ce que le fil en dit — ADR 0102.
 *
 * ── Le defaut mesure le 15/08/2026, en preproduction ───────────────────────
 *
 * Une vendeuse ouvre sa boutique par le formulaire en deux ecrans, avec une
 * photo. Le bot repond « Sac — 1 000 FCFA est en ligne », sans un mot sur la
 * photo. La boutique publique, elle, affiche un cadre vide : `imageKey` est
 * resté `null`.
 *
 * La cause tenait a l'ORDRE. `avecPhoto` se calculait sur la reponse du
 * formulaire — « le PhotoPicker portait une photo », donc l'INTENTION —, et
 * l'article naissait APRES la bulle. Le verdict reel du pipeline
 * (telechargement CDN, dechiffrement, re-encodage, televersement) existait,
 * il etait meme compte dans `catalog.bot.media`… et son seul porteur,
 * `messageArticlePublie`, etait supprime par `"deja_dite"` — la
 * deduplication de bulle de l'ADR 0088.
 *
 * C'est le constat D3 de l'audit 2026-08 rouvert par un autre chemin :
 * « quand la cause est connue, elle se DIT ». Une vendeuse qui n'apprend
 * rien renvoie la meme photo, echoue pareil, et conclut que ca ne marche pas.
 *
 * ── Ce que ce fichier tient ────────────────────────────────────────────────
 *
 * 1. La cause se dit, avec les mots du chemin normal.
 * 2. L'article naît **une seule fois** — le reordonnancement pourrait le
 *    creer deux fois, et deux articles pour un formulaire seraient pire que
 *    le defaut corrige.
 * 3. La regle d'ADR 0088 tient : une bulle, pas deux.
 */

const URL = process.env.DATABASE_URL;
const describeDb = URL ? describe : describe.skip;

let prisma: PrismaClient;
const ids = identifiants("bot-ouverture-photo");
const NOW = new Date("2026-08-15T10:00:00+01:00");

class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "memoire";
  readonly envoyes: MessageSortant[] = [];
  async envoyer(m: MessageSortant): Promise<void> {
    this.envoyes.push(m);
  }
}

/** Un lecteur qui ne rend JAMAIS de media — la panne CDN, ou le media expire. */
class MediaMuet implements LecteurMedia {
  readonly nom = "memoire";
  async lire(): Promise<MediaEntrant | null> {
    return null;
  }
  async lireCdn(_photo: PhotoCdnChiffree): Promise<MediaEntrant | null> {
    return null;
  }
}

const corps = (m: MessageSortant): string =>
  (m as { text?: { body?: string } }).text?.body ??
  (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ??
  "";

const texteEntrant = (de: string, texte: string) => ({
  messages: [{ from: de, type: "text", text: { body: texte } }],
});

/** La reponse d'un formulaire, telle que Meta la livre (`nfm_reply`). */
const reponseFlux = (de: string, charge: Record<string, unknown>) => ({
  messages: [
    {
      from: de,
      type: "interactive",
      interactive: {
        type: "nfm_reply",
        nfm_reply: { response_json: JSON.stringify(charge) },
      },
    },
  ],
});

interface Scene {
  waId: string;
  /**
   * Le nom de boutique vient du SCHEMA, pas d'une constante — et c'est le
   * defaut que ce fichier a lui-meme commis le 15/08/2026.
   *
   * Avec un nom fixe (« Chop »), le slug `chop` devient une ressource
   * PARTAGEE entre executions : un test qui echoue avant son nettoyage laisse
   * la boutique derriere lui, et l'execution suivante retrouve une vendeuse
   * deja inscrite sur le meme numero — le formulaire d'ouverture n'est alors
   * plus recevable, et l'echec ne ressemble en rien a sa cause. Le schema
   * d'identifiants existe exactement pour ca : ce qui est unique par
   * execution doit TOUT venir de lui.
   */
  boutique: string;
  envoyeur: EnvoyeurMemoire;
  deps: BotDeps;
}

function scene(): Scene {
  const n = ids.suivant();
  const waId = `23767${String(n).padStart(7, "0")}`;
  const envoyeur = new EnvoyeurMemoire();
  return {
    waId,
    boutique: `Chop ${n}`,
    envoyeur,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      maintenant: () => NOW,
      aleatoire: (nOctets: number) => new Uint8Array(randomBytes(nOctets)),
      media: new MediaMuet(),
      fluxOuvertureId: "1032068266296594",
    },
  };
}

/** Amene le fil jusqu'a l'etat ou le formulaire d'ouverture est recevable. */
async function jusquAuFormulaire(s: Scene): Promise<void> {
  await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "Bonjour"));
  await traiterLivraisonBot(s.deps, texteEntrant(s.waId, "je veux vendre"));
  s.envoyeur.envoyes.length = 0;
}

describeDb("la photo du formulaire d'ouverture (ADR 0102)", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("une photo qui n'arrive pas se DIT, et l'article naît une seule fois", async () => {
    const s = scene();
    await jusquAuFormulaire(s);

    /* La cause doit AUSSI se lire dans `fly logs` — ADR 0103. Sans
       collecteur OpenTelemetry, `mesurerMediaBot` est un appel sans effet :
       le journal est la seule trace qui existe en preproduction. */
    const lignes: string[] = [];
    const espion = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      lignes.push(a.map(String).join(" "));
    });

    await traiterLivraisonBot(
      s.deps,
      reponseFlux(s.waId, {
        flow_token: jetonFlux("ouverture"),
        boutique: s.boutique,
        ville: "Douala",
        langue: "fr",
        nom: "Sac",
        prix: "1 000",
        /* Le PhotoPicker a bien rendu une photo : c'est le pipeline qui
           echouera, et c'est precisement le cas que le defaut taisait. */
        photo: [{ id: "media-inexistant-0102" }],
      }),
    );
    espion.mockRestore();

    /* La cause et le transport, et RIEN d'autre : ni octets, ni identifiant
       de media, ni URL de CDN — celle-ci porte les cles de dechiffrement. */
    expect(lignes.some((l) => l.includes("photo non enregistree"))).toBe(true);
    expect(lignes.some((l) => l.includes("cause introuvable"))).toBe(true);
    expect(lignes.every((l) => !l.includes("media-inexistant-0102"))).toBe(true);

    const tout = s.envoyeur.envoyes.map(corps).join("\n");
    /* La cause, avec les MEMES mots que le chemin normal. */
    expect(tout).toContain("WhatsApp ne l'a pas fournie");
    /* Et surtout pas l'invitation, qui s'adresserait a qui n'a rien tente. */
    expect(tout).not.toMatch(/envoyez-la quand vous voulez/);

    const vendeuse = await prisma.seller.findUnique({ where: { phone: `+${s.waId}` } });
    if (!vendeuse) throw new Error("la boutique n'a pas ete creee");
    /* UN article — le reordonnancement de l'ADR 0102 ne doit pas le creer
       deux fois, une fois pour la bulle et une fois pour la publication. */
    const articles = await prisma.product.findMany({ where: { sellerId: vendeuse.id } });
    expect(articles).toHaveLength(1);
    expect(articles[0]?.imageKey).toBeNull();

    await prisma.product.deleteMany({ where: { sellerId: vendeuse.id } });
    await prisma.seller.deleteMany({ where: { id: vendeuse.id } });
    await prisma.botConversation.deleteMany({ where: { phone: `+${s.waId}` } });
  });

  it("sans photo demandee, la bulle garde l'invitation — rien n'a echoue", async () => {
    const s = scene();
    await jusquAuFormulaire(s);

    await traiterLivraisonBot(
      s.deps,
      reponseFlux(s.waId, {
        flow_token: jetonFlux("ouverture"),
        boutique: s.boutique,
        ville: "Douala",
        langue: "fr",
        nom: "Sac",
        prix: "1 000",
      }),
    );

    const tout = s.envoyeur.envoyes.map(corps).join("\n");
    expect(tout).toMatch(/envoyez-la quand vous voulez/);
    expect(tout).not.toContain("WhatsApp ne l'a pas fournie");

    const vendeuse = await prisma.seller.findUnique({ where: { phone: `+${s.waId}` } });
    if (!vendeuse) throw new Error("la boutique n'a pas ete creee");
    expect(await prisma.product.count({ where: { sellerId: vendeuse.id } })).toBe(1);

    await prisma.product.deleteMany({ where: { sellerId: vendeuse.id } });
    await prisma.seller.deleteMany({ where: { id: vendeuse.id } });
    await prisma.botConversation.deleteMany({ where: { phone: `+${s.waId}` } });
  });
});
