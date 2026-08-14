import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { livrerNotificationsEnAttente } from "../bot-notifications.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant, MessageTexte } from "../domain/bot/messages.ts";
import { describeDb } from "./_base.ts";
import { identifiants } from "./_identifiants.ts";

/**
 * La REMISE du recapitulatif d'absence — ADR 0105, cote service.
 *
 * Le domaine compose (`recap-absence.test.ts`) ; ici on verifie ce que la
 * file fait VRAIMENT : ce qui se resume part en un message, ce qui porte un
 * bouton ou un avertissement garde le sien, et rien n'est marque remis qui
 * n'est pas parti.
 */

let prisma: PrismaClient;
const ids = identifiants("recap-absence-remise");

class EnvoyeurMemoire implements EnvoyeurBot {
  readonly nom = "memoire";
  readonly envoyes: MessageSortant[] = [];
  async envoyer(m: MessageSortant): Promise<void> {
    this.envoyes.push(m);
  }
}

const corpsTexte = (m: MessageSortant) => (m as MessageTexte).text.body;

describeDb("le récapitulatif d'absence, contre la vraie file", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("trois notifications de commande deviennent UN message ; le bouton et l'avertissement gardent le leur", async () => {
    const phone = `+2376${String(ids.suivant()).padStart(8, "0")}`;
    const commande = (ref: string) =>
      `🛍️ *${ref} est créée.*\n1× Robe wax — 15 000 F\nNuméro à appeler : +237677001122`;

    /* Cinq en attente : trois resumables, un avertissement, un a boutons. */
    await prisma.botNotification.createMany({
      data: [
        { phone, corps: commande("CT-770001") },
        { phone, corps: commande("CT-770002") },
        { phone, corps: commande("CT-770003") },
        { phone, corps: "⚠️ *CT-770001 est contestée.*\nLa commande est gelée." },
        {
          phone,
          corps: "✅ Paiement prouvé.",
          boutons: [{ id: "contresigner", titre: "C'est bien moi" }] as unknown as object,
        },
      ],
    });

    const envoyeur = new EnvoyeurMemoire();
    await livrerNotificationsEnAttente({ prisma, envoyeur }, phone);

    /* TROIS messages : le recapitulatif, l'avertissement, le bouton. */
    expect(envoyeur.envoyes).toHaveLength(3);

    const recap = envoyeur.envoyes[0] as MessageTexte;
    expect(recap.type).toBe("text");
    expect(corpsTexte(recap)).toContain("3 nouvelles");
    expect(corpsTexte(recap)).toContain("· 🛍️ *CT-770001 est créée.*");
    expect(corpsTexte(recap)).not.toContain("Numéro à appeler");

    const suivants = envoyeur.envoyes.slice(1);
    expect(suivants.some((m) => m.type === "text" && corpsTexte(m).includes("contestée"))).toBe(
      true,
    );
    expect(suivants.some((m) => m.type === "interactive")).toBe(true);

    /* Tout est marque remis : rien ne repartira en double. */
    const restantes = await prisma.botNotification.count({ where: { phone, remisLe: null } });
    expect(restantes).toBe(0);
  });

  it("une SEULE notification résumable part entière — pas de récapitulatif d'un seul sujet", async () => {
    const phone = `+2376${String(ids.suivant()).padStart(8, "0")}`;
    await prisma.botNotification.create({
      data: { phone, corps: "🛍️ *CT-880001 est créée.*\nDétail complet ici." },
    });

    const envoyeur = new EnvoyeurMemoire();
    await livrerNotificationsEnAttente({ prisma, envoyeur }, phone);

    expect(envoyeur.envoyes).toHaveLength(1);
    expect(corpsTexte(envoyeur.envoyes[0] as MessageSortant)).toContain("Détail complet ici.");
  });
});
