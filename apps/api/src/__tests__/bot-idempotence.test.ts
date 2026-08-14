import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";
import { describeDb } from "./_base.ts";
import { selExecution } from "./_identifiants.ts";

/**
 * L'idempotence des messages entrants — ADR 0040.
 *
 * Le defaut que ce fichier verrouille a ete constate en bac a sable le
 * 05/08/2026, et il ne ressemblait pas a un probleme de livraison : la
 * boutique creee s'appelait **« Bonjour »**, et l'article **« Douala »**.
 * Ce sont les messages PRECEDENTS de la conversation, relivres par le relais
 * et rejoues dans la machine a un moment ou ils voulaient dire autre chose.
 *
 * WhatsApp livre AU MOINS une fois. Un test qui ne rejoue jamais la meme
 * livraison ne peut pas voir ce defaut — d'ou ce fichier, contre une vraie
 * base, ou la garde vit.
 */

let prisma: PrismaClient;
/* Un bloc de 1 000 identifiants PAR FICHIER, plus la minute courante.
   `selExecution()` seul donnait des blocs qui se recouvraient : deux
   fichiers demarres a quelques millisecondes d'ecart visaient le meme
   identifiant, et Vitest les lance en parallele contre UNE base. Le
   defaut a fait echouer deux verifications le 11/08/2026, dont un test
   de fuite — le genre de faux rouge qui masque un vrai. */
const RUN = 875 * 1000 + selExecution();
/**
 * ── L'horloge est celle du PRESENT, et ce n'est pas un detail ─────────────
 *
 * Elle etait figee au 05/08/2026 — la date du defaut, en guise de recit. Cela
 * rendait ce fichier fragile a un titre qu'on ne voit pas en le lisant :
 *
 * `traiterLivraisonBot` se termine par une purge GLOBALE et DATEE — elle
 * supprime tout `bot_message_vu` dont `reclameLe` remonte a plus de trois
 * jours de SON horloge a elle. Un autre fichier de tests, joue en parallele
 * avec l'horloge reelle, effacait donc les lignes de celui-ci en plein milieu.
 * La garde d'idempotence se retrouvait desarmee : chaque relivraison creait sa
 * ligne a neuf et repondait.
 *
 * Mesure du 14/08 (sel 911) : « expected 4 to be 1 » sur la relivraison — les
 * trois rejeux traites —, et « expected 0 to be 1 » sur la ligne recente du
 * test de purge. Puis reproduit HORS SUITE, deterministe : une ligne posee au
 * 05/08 disparait au premier passage d'un `traiterLivraisonBot` a l'heure
 * reelle.
 *
 * **Ce n'est pas un defaut du produit.** En production toutes les instances
 * partagent la meme horloge : aucune ne purge les lignes fraiches d'une autre.
 * C'est le fait d'epingler une horloge dans le passe tout en appelant du code
 * qui purge globalement par le temps.
 *
 * Tous les usages de `NOW` ci-dessous sont RELATIFS — des ecarts. Rien ne
 * dependait de la date elle-meme, et le recit du 05/08 vit dans l'en-tete.
 */
const NOW = new Date();

class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "memoire";
  readonly envoyes: MessageSortant[] = [];
  async envoyer(m: MessageSortant): Promise<void> {
    this.envoyes.push(m);
  }
}

const corps = (m: MessageSortant): string =>
  (m as { text?: { body?: string }; interactive?: { body?: { text?: string } } }).text?.body ??
  (m as { interactive?: { body?: { text?: string } } }).interactive?.body?.text ??
  "";

/** Une livraison telle que le relais la pose — avec son `wamid`. */
const livraison = (de: string, texte: string, id: string) => ({
  messages: [{ from: de, id, type: "text", text: { body: texte } }],
});

let compteur = 0;
const suivant = () => `wamid.test.${RUN}.${++compteur}`;

function scene(maintenant: Date = NOW): { envoyeur: EnvoyeurMemoire; deps: BotDeps } {
  const envoyeur = new EnvoyeurMemoire();
  return {
    envoyeur,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      maintenant: () => maintenant,
      aleatoire: (n: number) => new Uint8Array(randomBytes(n)),
    },
  };
}

describeDb("idempotence des messages entrants (ADR 0040)", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("la MEME livraison rejouee ne repond qu'une fois", async () => {
    const de = `2379${String(10000000 + RUN).slice(-8)}`;
    const id = suivant();
    const s = scene();

    await traiterLivraisonBot(s.deps, livraison(de, "Bonjour", id));
    const apresPremier = s.envoyeur.envoyes.length;
    expect(apresPremier).toBeGreaterThan(0);

    /* Le relais reessaie : trois fois, comme sur les captures du 05/08. */
    for (let i = 0; i < 3; i++) await traiterLivraisonBot(s.deps, livraison(de, "Bonjour", id));
    expect(s.envoyeur.envoyes.length).toBe(apresPremier);

    await prisma.botConversation.deleteMany({ where: { phone: `+${de}` } });
    await prisma.botMessageVu.deleteMany({ where: { id } });
  });

  it("un envoi qui meurt se NOMME au journal — la panne muette du 07/08/2026", async () => {
    /* Meta a gele le numero sur (#131037) : chaque reponse mourait en 400,
       avalee par le catch interne sans une ligne. Le code d'erreur — un
       ENTIER, sans contenu — doit desormais se lire dans `fly logs`. */
    const de = `2379${String(70000000 + RUN).slice(-8)}`;
    const id = suivant();
    const s = scene();
    s.deps.envoyeur = {
      nom: "panne",
      async envoyer() {
        throw new Error("envoi bot refuse : HTTP 400, code Meta 131037");
      },
    };
    const lignes: string[] = [];
    const espion = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      lignes.push(a.map(String).join(" "));
    });
    try {
      await traiterLivraisonBot(s.deps, livraison(de, "Bonjour", id));
    } finally {
      espion.mockRestore();
    }
    expect(lignes.some((l) => l.includes("code Meta 131037"))).toBe(true);
    expect(lignes.every((l) => !l.includes("Bonjour"))).toBe(true);

    await prisma.botConversation.deleteMany({ where: { phone: `+${de}` } });
    await prisma.botMessageVu.deleteMany({ where: { id } });
  });

  it("LE defaut du 05/08 : un vieux message relivre ne devient pas le nom de la boutique", async () => {
    const de = `2379${String(20000000 + RUN).slice(-8)}`;
    const bonjour = suivant();
    const vendre = suivant();
    const s = scene();

    /* 1. « Bonjour » — le bot repond en acheteuse et propose de vendre. */
    await traiterLivraisonBot(s.deps, livraison(de, "Bonjour", bonjour));
    /* 2. La prospect demande a ouvrir sa boutique : le bot demande le NOM. */
    await traiterLivraisonBot(s.deps, livraison(de, "je veux vendre", vendre));
    expect(s.envoyeur.envoyes.map(corps).join("\n")).toMatch(/Comment s'appelle votre boutique/);

    /* 3. Le relais relivre « Bonjour ». SANS la garde, il est lu comme le nom
          de la boutique — c'est exactement ce qui s'est produit. */
    s.envoyeur.envoyes.length = 0;
    await traiterLivraisonBot(s.deps, livraison(de, "Bonjour", bonjour));
    expect(s.envoyeur.envoyes).toEqual([]);

    /* Aucune boutique nommee « Bonjour » n'est nee de ce numero. */
    const conv = await prisma.botConversation.findUnique({ where: { phone: `+${de}` } });
    expect(JSON.stringify(conv?.etat ?? {})).not.toContain("Bonjour");
    expect(await prisma.seller.count({ where: { businessName: "Bonjour" } })).toBe(0);

    await prisma.botConversation.deleteMany({ where: { phone: `+${de}` } });
    await prisma.botMessageVu.deleteMany({ where: { id: { in: [bonjour, vendre] } } });
  });

  it("une reclamation morte en chemin se laisse rejouer — passe un delai", async () => {
    const de = `2379${String(30000000 + RUN).slice(-8)}`;
    const id = suivant();

    /* Un traitement qui a reclame puis n'a jamais fini : le processus est mort
       entre les deux. La relivraison est notre seconde chance. */
    await prisma.botMessageVu.create({
      data: { id, reclameLe: new Date(NOW.getTime() - 5 * 60_000), termineLe: null },
    });

    const s = scene();
    await traiterLivraisonBot(s.deps, livraison(de, "Bonjour", id));
    expect(s.envoyeur.envoyes.length).toBeGreaterThan(0);

    /* Fraiche, en revanche, elle est laissee tranquille : c'est le cas du
       relais qui reessaie pendant que le premier travaille encore. */
    const frais = suivant();
    await prisma.botMessageVu.create({
      data: { id: frais, reclameLe: new Date(NOW.getTime() - 1000), termineLe: null },
    });
    const s2 = scene();
    await traiterLivraisonBot(s2.deps, livraison(de, "Bonjour", frais));
    expect(s2.envoyeur.envoyes).toEqual([]);

    await prisma.botConversation.deleteMany({ where: { phone: `+${de}` } });
    await prisma.botMessageVu.deleteMany({ where: { id: { in: [id, frais] } } });
  });

  it("sans wamid, on traite — le simulateur de terrain rejoue a dessein", async () => {
    const de = `2379${String(40000000 + RUN).slice(-8)}`;
    const s = scene();
    const sans = { messages: [{ from: de, type: "text", text: { body: "Bonjour" } }] };

    await traiterLivraisonBot(s.deps, sans);
    const un = s.envoyeur.envoyes.length;
    await traiterLivraisonBot(s.deps, sans);
    expect(s.envoyeur.envoyes.length).toBeGreaterThan(un);

    await prisma.botConversation.deleteMany({ where: { phone: `+${de}` } });
  });

  it("purge les vues anciennes, garde les recentes", async () => {
    const vieux = suivant();
    const recent = suivant();
    await prisma.botMessageVu.createMany({
      data: [
        { id: vieux, reclameLe: new Date(NOW.getTime() - 5 * 24 * 3600_000), termineLe: NOW },
        { id: recent, reclameLe: new Date(NOW.getTime() - 3600_000), termineLe: NOW },
      ],
    });

    const de = `2379${String(50000000 + RUN).slice(-8)}`;
    const s = scene();
    await traiterLivraisonBot(s.deps, livraison(de, "Bonjour", suivant()));

    expect(await prisma.botMessageVu.count({ where: { id: vieux } })).toBe(0);
    expect(await prisma.botMessageVu.count({ where: { id: recent } })).toBe(1);

    await prisma.botConversation.deleteMany({ where: { phone: `+${de}` } });
    await prisma.botMessageVu.deleteMany({ where: { id: recent } });
  });
});
