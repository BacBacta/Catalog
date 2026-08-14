import { randomBytes } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type BotDeps, traiterLivraisonBot } from "../bot.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageBoutons, MessageSortant } from "../domain/bot/messages.ts";
import { describeDb } from "./_base.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * L'ouverture de fil, DE BOUT EN BOUT — ADR 0106.
 *
 * ── Pourquoi ce test traverse le service, et pas la machine ──────────────
 *
 * La machine avait sa branche `ouverture_fil`, verte dans ses tests — et
 * JAMAIS atteinte en production : `entreePourAcheteuse` deleguait a
 * `entreePourMachine`, qui fondait l'ouverture en texte vide AVANT la
 * machine. Sixieme occurrence du meme motif aujourd'hui : l'instrument
 * mesurait sa propre forme, la jonction restait sans temoin.
 *
 * Ce fichier joue donc la livraison Meta REELLE (`request_welcome`, la forme
 * documentee) a travers `traiterLivraisonBot`, et lit ce qui SORT.
 */

let prisma: PrismaClient;
const ids = identifiants("bot-ouverture-fil");

class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "memoire";
  readonly envoyes: MessageSortant[] = [];
  async envoyer(m: MessageSortant): Promise<void> {
    this.envoyes.push(m);
  }
}

function scene(): { envoyeur: EnvoyeurMemoire; deps: BotDeps } {
  const envoyeur = new EnvoyeurMemoire();
  return {
    envoyeur,
    deps: {
      prisma,
      envoyeur,
      baseBoutique: "https://boutique.test",
      baseApp: "https://app.test",
      maintenant: () => new Date(),
      aleatoire: (n: number) => new Uint8Array(randomBytes(n)),
    },
  };
}

describeDb("request_welcome traverse le service — ADR 0106", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("une inconnue ouvre le fil : l'accueil a TROIS portes part, sans qu'elle ait rien ecrit", async () => {
    const s = scene();
    const de = `2376${String(ids.suivant()).padStart(8, "0")}`;
    await traiterLivraisonBot(s.deps, {
      messages: [{ from: de, id: `wamid.ouverture.${de}`, type: "request_welcome" }],
    });

    expect(s.envoyeur.envoyes.length).toBeGreaterThan(0);
    const accueil = s.envoyeur.envoyes.at(-1) as MessageBoutons;
    expect(accueil.type).toBe("interactive");
    expect(accueil.interactive.action.buttons.map((b) => b.reply.id)).toEqual([
      "vendre",
      "suivi",
      "comment",
    ]);
    /* Le message dit ce que Catalog EST — c'est la copie de l'ADR 0103,
       jamais « je ne sais pas lire ce type de message ». */
    expect(accueil.interactive.body.text).toContain("Je suis Catalog");
  });

  it("relivre, l'ouverture ne repond qu'UNE fois — l'idempotence la couvre aussi", async () => {
    const s = scene();
    const de = `2376${String(ids.suivant()).padStart(8, "0")}`;
    const corps = {
      messages: [{ from: de, id: `wamid.ouverture.bis.${de}`, type: "request_welcome" }],
    };
    await traiterLivraisonBot(s.deps, corps);
    const apresPremier = s.envoyeur.envoyes.length;
    await traiterLivraisonBot(s.deps, corps);
    expect(s.envoyeur.envoyes.length).toBe(apresPremier);
  });
});
