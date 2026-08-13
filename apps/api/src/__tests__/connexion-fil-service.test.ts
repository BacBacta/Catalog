import type { PrismaClient } from "@catalog/db";
import { beforeEach, describe, expect, it } from "vitest";
import type { MagasinDefis } from "../auth-connexion-whatsapp.ts";
import { accuserConnexionDansLeFil } from "../connexion-fil.ts";
import type { EnvoyeurBot } from "../domain/bot/envoyeur.ts";
import type { MessageSortant } from "../domain/bot/messages.ts";

/**
 * Le fil repond a un message de connexion — banc du 13/08/2026.
 *
 * Ce test tient le CABLAGE : le domaine decide quoi dire, ce service decide
 * a qui, dans quelle langue, et une seule fois par code.
 */

class MagasinFactice implements MagasinDefis {
  lignes = new Map<string, { value: string; expiresAt: Date }>();
  async createVerificationValue(d: { identifier: string; value: string; expiresAt: Date }) {
    this.lignes.set(d.identifier, { value: d.value, expiresAt: d.expiresAt });
    return d;
  }
  async findVerificationValue(identifier: string) {
    return this.lignes.get(identifier) ?? null;
  }
  async consumeVerificationValue(identifier: string) {
    const l = this.lignes.get(identifier) ?? null;
    this.lignes.delete(identifier);
    return l;
  }
}

class EnvoyeurFactice implements EnvoyeurBot {
  readonly nom = "factice";
  envoyes: MessageSortant[] = [];
  async envoyer(m: MessageSortant) {
    this.envoyes.push(m);
  }
}

const prismaVide = {
  botConversation: { findUnique: async () => null },
} as unknown as PrismaClient;

const prismaAnglais = {
  botConversation: { findUnique: async () => ({ langue: "en" }) },
} as unknown as PrismaClient;

let magasin: MagasinFactice;
let envoyeur: EnvoyeurFactice;

beforeEach(() => {
  magasin = new MagasinFactice();
  envoyeur = new EnvoyeurFactice();
});

const corps = (m: MessageSortant) => (m as { text: { body: string } }).text.body;

describe("l'accuse de connexion dans le fil", () => {
  it("se tait sur une conversation ordinaire", async () => {
    await accuserConnexionDansLeFil(
      { magasin, envoyeur, prisma: prismaVide },
      { de: "237677123456", texte: "Bonjour, je veux commander" },
      "ignore",
    );
    expect(envoyeur.envoyes).toHaveLength(0);
  });

  it("confirme une connexion reussie, au numero qui a ecrit", async () => {
    await accuserConnexionDansLeFil(
      { magasin, envoyeur, prisma: prismaVide },
      { de: "237677123456", texte: "Connexion Catalog : 7BMX-VS" },
      "verifie",
    );
    expect(envoyeur.envoyes).toHaveLength(1);
    expect((envoyeur.envoyes[0] as { to: string }).to).toBe("237677123456");
    expect(corps(envoyeur.envoyes[0] as MessageSortant)).toMatch(/confirmée/i);
  });

  it("dit qu'un code est mort au lieu de laisser chercher", async () => {
    await accuserConnexionDansLeFil(
      { magasin, envoyeur, prisma: prismaVide },
      { de: "237677123456", texte: "Connexion Catalog : 7BMX-VS" },
      "ignore",
    );
    expect(corps(envoyeur.envoyes[0] as MessageSortant)).toMatch(/plus valable/i);
  });

  /**
   * LE cas des relivraisons Meta : a la seconde passe le code est deja
   * consomme, donc le verdict est « ignore ». Sans la marque, la personne qui
   * vient de se connecter recevrait « ce code n'est plus valable ».
   */
  it("ne se contredit pas quand Meta relivre le meme message", async () => {
    const m = { de: "237677123456", texte: "Connexion Catalog : 7BMX-VS" };
    await accuserConnexionDansLeFil({ magasin, envoyeur, prisma: prismaVide }, m, "verifie");
    await accuserConnexionDansLeFil({ magasin, envoyeur, prisma: prismaVide }, m, "ignore");
    expect(envoyeur.envoyes).toHaveLength(1);
    expect(corps(envoyeur.envoyes[0] as MessageSortant)).toMatch(/confirmée/i);
  });

  it("un AUTRE code garde droit a sa reponse", async () => {
    await accuserConnexionDansLeFil(
      { magasin, envoyeur, prisma: prismaVide },
      { de: "237677123456", texte: "Connexion Catalog : 7BMX-VS" },
      "verifie",
    );
    await accuserConnexionDansLeFil(
      { magasin, envoyeur, prisma: prismaVide },
      { de: "237677123456", texte: "Connexion Catalog : SW2Y-ZN" },
      "ignore",
    );
    expect(envoyeur.envoyes).toHaveLength(2);
  });

  it("parle la langue du fil quand ce fil en a une", async () => {
    await accuserConnexionDansLeFil(
      { magasin, envoyeur, prisma: prismaAnglais },
      { de: "237677123456", texte: "Connexion Catalog : 7BMX-VS" },
      "verifie",
    );
    expect(corps(envoyeur.envoyes[0] as MessageSortant)).toMatch(/signed in/i);
  });

  /* Un numero etranger se connecte (ADR 0080) : il doit etre accuse comme un
     autre — c'est meme lui qui a trouve le defaut. */
  it("accuse aussi un numero hors Cameroun", async () => {
    await accuserConnexionDansLeFil(
      { magasin, envoyeur, prisma: prismaVide },
      { de: "32466457281", texte: "Connexion Catalog : 7BMX-VS" },
      "verifie",
    );
    expect(envoyeur.envoyes).toHaveLength(1);
    expect((envoyeur.envoyes[0] as { to: string }).to).toBe("32466457281");
  });

  /* Un envoi qui echoue ne doit pas poser la marque : la relivraison de Meta
     est alors une seconde chance, pas un silence de plus. */
  it("ne marque rien quand l'envoi echoue", async () => {
    const cassé: EnvoyeurBot = {
      nom: "casse",
      envoyer: async () => {
        throw new Error("transport indisponible");
      },
    };
    const m = { de: "237677123456", texte: "Connexion Catalog : 7BMX-VS" };
    await expect(
      accuserConnexionDansLeFil({ magasin, envoyeur: cassé, prisma: prismaVide }, m, "verifie"),
    ).rejects.toThrow();
    await accuserConnexionDansLeFil({ magasin, envoyeur, prisma: prismaVide }, m, "verifie");
    expect(envoyeur.envoyes).toHaveLength(1);
  });
});
