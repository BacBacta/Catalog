import { createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@catalog/db";
import {
  DUREE_OTP_MS,
  genererCodeOtp,
  type OtpEnregistre,
  type VerdictOtp,
  verifierCodeOtp,
} from "../domain/payout-otp.ts";

/**
 * Le support de l'OTP de reversement : emission, empreinte, verification.
 *
 * **L'empreinte est un HMAC, pas un simple SHA-256.** Six chiffres, c'est un
 * million de possibilites : une table arc-en-ciel se calcule en une seconde. La
 * cle du HMAC est ce qui rend le pre-calcul impossible pour qui lit la base sans
 * avoir le secret du serveur.
 *
 * Le secret vient de la configuration et n'a **pas de valeur de repli** : un
 * secret par defaut serait le meme partout, donc public.
 */
export class PayoutOtpStore {
  readonly #prisma: PrismaClient;
  readonly #secret: string;
  readonly #alea: (n: number) => Uint8Array;

  constructor(deps: {
    prisma: PrismaClient;
    secret?: string | undefined;
    randomBytes?: (n: number) => Uint8Array;
  }) {
    const secret = deps.secret ?? process.env.PAYOUT_OTP_SECRET ?? process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      throw new Error(
        "PAYOUT_OTP_SECRET (ou BETTER_AUTH_SECRET) est requis : sans cle, " +
          "l'empreinte d'un code a six chiffres se pre-calcule en une seconde.",
      );
    }
    this.#prisma = deps.prisma;
    this.#secret = secret;
    this.#alea = deps.randomBytes ?? ((n) => new Uint8Array(nodeRandomBytes(n)));
  }

  empreinte(code: string): string {
    return createHmac("sha256", this.#secret).update(code).digest("hex");
  }

  /**
   * Emet un nouveau code et renvoie le clair, une seule fois, a l'appelant qui
   * va l'envoyer par SMS. Il n'est jamais relu ensuite : seule l'empreinte reste.
   *
   * Les codes precedents encore vivants sont consommes : deux codes valides en
   * meme temps doublent la surface de devinette sans rien apporter.
   */
  async emettre(
    sellerId: string,
    phone: string,
    now: Date,
  ): Promise<{ otpId: string; code: string }> {
    const code = genererCodeOtp(this.#alea);
    const { id } = await this.#prisma.$transaction(async (tx) => {
      await tx.payoutOtp.updateMany({
        where: { sellerId, consumedAt: null },
        data: { consumedAt: now },
      });
      return tx.payoutOtp.create({
        data: {
          sellerId,
          phone,
          codeHash: this.empreinte(code),
          expiresAt: new Date(now.getTime() + DUREE_OTP_MS),
        },
        select: { id: true },
      });
    });
    return { otpId: id, code };
  }

  /** Derniere ligne emise pour cette vendeuse, consommee ou non. */
  async derniere(sellerId: string): Promise<OtpEnregistre | null> {
    const l = await this.#prisma.payoutOtp.findFirst({
      where: { sellerId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        phone: true,
        codeHash: true,
        expiresAt: true,
        consumedAt: true,
        attempts: true,
      },
    });
    return l;
  }

  /**
   * Verifie une saisie et applique les effets de bord decides par le domaine :
   * incrementer les essais, consommer la ligne.
   *
   * Le succes consomme aussi : un code ne vaut qu'une fois. C'est ce qui empeche
   * de rejouer la meme saisie pour pousser un second numero.
   */
  async verifier(sellerId: string, code: string, now: Date): Promise<VerdictOtp> {
    const ligne = await this.derniere(sellerId);
    const verdict = verifierCodeOtp(
      ligne,
      { code, empreinte: (c) => this.empreinte(c), now },
      comparerEnTempsConstant,
    );

    if (verdict.ok) {
      await this.#prisma.payoutOtp.update({
        where: { id: verdict.otpId },
        data: { consumedAt: now },
      });
      return verdict;
    }

    if (verdict.otpId && verdict.raison === "code_incorrect") {
      await this.#prisma.payoutOtp.update({
        where: { id: verdict.otpId },
        data: { attempts: { increment: 1 }, ...(verdict.bruler ? { consumedAt: now } : {}) },
      });
    } else if (verdict.otpId && verdict.bruler) {
      await this.#prisma.payoutOtp.update({
        where: { id: verdict.otpId },
        data: { consumedAt: now },
      });
    }
    return verdict;
  }

  /** Purge des lignes expirees. Cette table n'est pas un journal d'audit. */
  async purger(avant: Date): Promise<number> {
    const { count } = await this.#prisma.payoutOtp.deleteMany({
      where: { expiresAt: { lt: avant } },
    });
    return count;
  }
}

/**
 * Comparaison en temps constant.
 *
 * Un `===` sur des empreintes fuit leur prefixe commun par le temps de retour.
 * Ce n'est pas theorique sur six chiffres : c'est le seul secret en jeu.
 */
export function comparerEnTempsConstant(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}
