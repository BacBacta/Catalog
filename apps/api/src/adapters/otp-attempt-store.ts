import type { PrismaClient } from "@catalog/db";
import type { OtpAttempt } from "../domain/rate-limit.ts";

/**
 * Magasin des demandes d'OTP — le support DURABLE de la limitation de debit.
 *
 * Le domaine (`rate-limit.ts`) est pur : il recoit la liste des tentatives et
 * rend une decision. Ce fichier est ce qui rend cette decision opposable dans le
 * temps.
 *
 * **Pourquoi la base et pas la memoire.** Un compteur en memoire se remet a zero
 * a chaque redeploiement, et un attaquant qui le sait attend un deploiement. Un
 * SMS coute de l'argent : une limite qui ne survit pas au processus ne protege
 * ni le numero inonde, ni la facture.
 *
 * **La fenetre de lecture est le jour civil.** C'est la plus large dont le
 * domaine a besoin — les fenetres courtes font au plus une heure, les plafonds
 * sont journaliers — et le plafond global borne le volume a charger. Une seule
 * requete suffit donc a decider, ce qui evite quatre allers-retours par demande.
 */
export interface OtpAttemptStore {
  /** Tentatives depuis `depuis`, tous numeros et toutes adresses confondus. */
  depuis(depuis: Date): Promise<OtpAttempt[]>;
  enregistrer(a: OtpAttempt & { kind: string }): Promise<void>;
  /** Purge les lignes anterieures a `avant`. Renvoie le nombre supprime. */
  purger(avant: Date): Promise<number>;
}

export class PrismaOtpAttemptStore implements OtpAttemptStore {
  readonly #prisma: PrismaClient;

  /**
   * Champ prive explicite, pas une propriete de parametre (`constructor(private
   * x)`). Node 24 execute le TypeScript en retirant les types SANS les
   * transformer : une propriete de parametre y est une erreur de syntaxe au
   * demarrage, invisible au `tsc --noEmit`.
   */
  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async depuis(depuis: Date): Promise<OtpAttempt[]> {
    const lignes = await this.#prisma.otpAttempt.findMany({
      where: { at: { gte: depuis } },
      select: { phone: true, ip: true, at: true },
      orderBy: { at: "asc" },
    });
    return lignes;
  }

  async enregistrer(a: OtpAttempt & { kind: string }): Promise<void> {
    await this.#prisma.otpAttempt.create({
      data: { phone: a.phone, ip: a.ip, kind: a.kind, at: a.at },
    });
  }

  /**
   * Purge. Cette table n'est PAS en ajout seul, a la difference des journaux
   * d'audit : c'est de la donnee operationnelle avec une duree de conservation.
   * Sans purge elle grossit sans fin ; avec un trigger d'ajout seul, on ne
   * pourrait pas purger. La distinction est voulue.
   */
  async purger(avant: Date): Promise<number> {
    const { count } = await this.#prisma.otpAttempt.deleteMany({
      where: { at: { lt: avant } },
    });
    return count;
  }
}

/** Debut du jour civil, en heure locale du processus (TZ=Africa/Douala). */
export function debutDuJour(d: Date): Date {
  const j = new Date(d);
  j.setHours(0, 0, 0, 0);
  return j;
}
