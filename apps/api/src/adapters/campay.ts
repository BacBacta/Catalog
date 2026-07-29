import type { PaymentStatus } from "@swap/contracts";
import type {
  InitiateInput,
  InitiateResult,
  Operator,
  PaymentProvider,
  StatusResult,
} from "../domain/payment-provider.ts";

/**
 * Adaptateur CamPay.
 *
 * Surface relevee le 29/07/2026 sur le SDK Python officiel
 * (github.com/CamPay/campay-python-sdk) :
 *
 *   POST /api/token/                    -> jeton temporaire
 *   POST /api/collect/                  -> encaisser chez un payeur
 *   POST /api/withdraw/                 -> reverser vers un numero
 *   GET  /api/transaction/{ref}/        -> statut
 *   GET  /api/balance/                  -> solde, ventile MTN / Orange
 *   POST /api/get_payment_link/         -> page de paiement hebergee
 *   POST /api/history/                  -> historique, start_date / end_date
 *
 * Statuts renvoyes : PENDING | SUCCESSFUL | FAILED.
 *
 * DEUX LIMITES CONNUES, a poser par ecrit a CamPay avant integration :
 *
 * 1. `collect` n'a PAS de champ beneficiaire. Les fonds atterrissent sur le
 *    solde du compte marchand, et il faut un `withdraw` pour les reverser.
 *    C'est le modele « compte marchand unique », que l'ADR 0006 ecarte : il
 *    ferait detenir des fonds a Swap. A ne pas mettre en production sans une
 *    reponse ecrite sur un eventuel modele sous-marchand.
 *
 * 2. La reponse ne contient QUE la reference CamPay (un UUID). La reference
 *    de l'operateur — celle du SMS recu par la vendeuse — n'est pas exposee.
 *    Le rapprochement entre la voie agregateur et la voie SMS ne peut donc
 *    pas se faire sur un identifiant commun. A demander : est-elle disponible
 *    dans le webhook ou dans un champ etendu du statut ?
 */

const BASE = {
  PROD: "https://www.campay.net",
  DEV: "https://demo.campay.net",
} as const;

export interface CampayConfig {
  /** Jeton permanent (section APP KEYS). Envoye en `Authorization: Token …`. */
  permanentToken: string;
  environment: keyof typeof BASE;
  /** Secret de signature des webhooks, si CamPay en fournit un. */
  webhookSecret?: string;
  fetchImpl?: typeof fetch;
}

/** CamPay attend un numero SANS le « + » : 237XXXXXXXXX. */
export function toCampayMsisdn(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (!/^237[62]\d{8}$/.test(digits)) {
    throw new Error(`numero inattendu pour CamPay: ${e164}`);
  }
  return digits;
}

/**
 * Codes d'erreur documentes. ER301 merite une attention particuliere : il
 * signale un solde insuffisant au moment d'un reversement — c'est le cas
 * « flottant vide » cote prestataire, qui ne se voit pas dans le metier et
 * doit declencher une alerte plutot qu'une simple erreur.
 */
export const CAMPAY_ERRORS = {
  ER101: "numero invalide — il doit commencer par l'indicatif pays (237…)",
  ER102: "operateur non supporte — seuls MTN et Orange sont acceptes",
  ER201: "montant invalide — les decimales sont refusees",
  ER301: "solde insuffisant pour le reversement (flottant epuise)",
} as const;

export type CampayErrorCode = keyof typeof CAMPAY_ERRORS;

export class CampayError extends Error {
  constructor(
    readonly code: CampayErrorCode | "UNKNOWN",
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "CampayError";
  }
  /** Un flottant epuise se retente plus tard ; un numero invalide, jamais. */
  get retryable(): boolean {
    return this.code === "ER301";
  }
}

function toCampayError(payload: unknown, httpStatus?: number): CampayError {
  const p = payload as { error_code?: string; message?: string } | null;
  const code = p?.error_code as CampayErrorCode | undefined;
  if (code && code in CAMPAY_ERRORS) {
    return new CampayError(code, CAMPAY_ERRORS[code], httpStatus);
  }
  return new CampayError("UNKNOWN", p?.message ?? `HTTP ${httpStatus ?? "?"}`, httpStatus);
}

const STATUS_MAP: Record<string, PaymentStatus> = {
  PENDING: "waiting_customer",
  SUCCESSFUL: "paid",
  FAILED: "failed",
};

/**
 * PENDING signifie que la payeuse n'a pas encore saisi son code secret.
 * Ce n'est PAS un echec — voir AGENTS.md. On le projette sur
 * `waiting_customer`, jamais sur `failed`.
 */
export function mapStatus(raw: string): PaymentStatus {
  return STATUS_MAP[raw?.toUpperCase?.()] ?? "initiated";
}

interface CollectResponse {
  reference: string;
  ussd_code?: string;
  operator?: string;
  status?: string;
}
interface TransactionResponse {
  reference: string;
  status: string;
  amount?: number | string;
  external_reference?: string;
  operator?: string;
  /** Non documente : certains prestataires exposent ici la ref operateur. */
  operator_reference?: string;
  [k: string]: unknown;
}

export class CampayProvider implements PaymentProvider {
  readonly name = "campay";
  readonly #base: string;
  readonly #token: string;
  readonly #secret: string | undefined;
  readonly #fetch: typeof fetch;

  constructor(cfg: CampayConfig) {
    this.#base = BASE[cfg.environment];
    this.#token = cfg.permanentToken;
    this.#secret = cfg.webhookSecret;
    this.#fetch = cfg.fetchImpl ?? fetch;
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.#fetch(`${this.#base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${this.#token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let payload: unknown = null;
      try {
        payload = await res.json();
      } catch {
        /* corps non JSON : on garde le statut HTTP */
      }
      throw toCampayError(payload, res.status);
    }
    return (await res.json()) as T;
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    if (!Number.isInteger(input.amountXaf)) {
      throw new Error("le montant doit etre un entier XAF");
    }
    const r = await this.#post<CollectResponse>("/api/collect/", {
      amount: String(input.amountXaf), // pas de decimales acceptees
      currency: "XAF",
      from: toCampayMsisdn(input.payerPhone),
      description: input.description,
      external_reference: input.orderRef,
    });
    const out: InitiateResult = { providerTxId: r.reference };
    if (r.ussd_code) out.ussdCode = r.ussd_code;
    if (r.operator) out.operator = r.operator.toLowerCase() as Operator;
    return out;
  }

  async checkStatus(providerTxId: string): Promise<StatusResult> {
    const res = await this.#fetch(`${this.#base}/api/transaction/${providerTxId}/`, {
      headers: { Authorization: `Token ${this.#token}` },
    });
    if (!res.ok) throw new Error(`campay statut -> HTTP ${res.status}`);
    const r = (await res.json()) as TransactionResponse;
    const out: StatusResult = { status: mapStatus(r.status), raw: r };
    if (r.amount !== undefined) out.amountXaf = Math.round(Number(r.amount));
    if (r.operator_reference) out.operatorRef = r.operator_reference;
    return out;
  }

  /**
   * Le tableau de bord CamPay expose une « Cle webhook de l'application ».
   * Son existence etablit que les notifications SONT authentifiees — c'est
   * ce secret qu'il faut passer dans `webhookSecret`.
   *
   * En revanche le SCHEMA reste inconnu : en-tete ou champ du corps, HMAC
   * brut ou jeton signe, et sur quelle representation exacte du corps.
   * L'implementation ci-dessous suppose un HMAC-SHA256 hexadecimal sur le
   * corps brut, dans un en-tete `x-campay-signature` — a confirmer avec
   * `apps/api/scripts/webhook-capture.mjs`, qui releve les en-tetes verbatim.
   *
   * En attendant, on refuse tout ce qui n'est pas signe : une notification
   * non authentifiee ne doit jamais faire avancer un paiement. Le filet
   * reste `checkStatus`, qui fait seul autorite.
   */
  verifySignature(rawBody: string, headers: Record<string, string>): boolean {
    if (!this.#secret) return false;
    const provided = headers["x-campay-signature"] ?? headers["X-Campay-Signature"];
    if (!provided) return false;
    return timingSafeEqualHex(provided, hmacSha256Hex(this.#secret, rawBody));
  }

  /**
   * Reversement vers le numero de la vendeuse. Necessite l'activation du
   * retrait par API cote CamPay. A n'utiliser QUE si un modele sous-marchand
   * n'est pas disponible — voir l'avertissement en tete de fichier.
   */
  async disburse(input: {
    amountXaf: number;
    toPhone: string;
    orderRef: string;
    description: string;
  }) {
    if (!Number.isInteger(input.amountXaf)) {
      throw new Error("le montant doit etre un entier XAF");
    }
    return this.#post<{ reference: string; status: string }>("/api/withdraw/", {
      amount: String(input.amountXaf),
      currency: "XAF",
      to: toCampayMsisdn(input.toPhone),
      description: input.description,
      external_reference: input.orderRef,
    });
  }

  /**
   * Historique des transactions sur une periode. Endpoint releve sur le
   * wrapper PHP communautaire, absent du SDK Python — il n'est PAS documente
   * publiquement, donc la forme exacte de la reponse reste a confirmer en
   * bac a sable. Interet : c'est le seul endroit ou la reference de
   * l'operateur pourrait apparaitre. A verifier en priorite.
   */
  async history(range?: { startDate: string; endDate: string }) {
    const today = range?.endDate;
    const body = range ? { start_date: range.startDate, end_date: today } : {};
    return this.#post<{ transactions?: unknown[] } & Record<string, unknown>>(
      "/api/history/",
      body,
    );
  }

  /**
   * CamPay ventile son solde par operateur. Un solde MTN a zero fait echouer
   * les reversements vers MTN sans que rien ne le signale cote metier :
   * a surveiller, avec une alerte sous seuil.
   */
  async balance() {
    const res = await this.#fetch(`${this.#base}/api/balance/`, {
      headers: { Authorization: `Token ${this.#token}` },
    });
    if (!res.ok) throw new Error(`campay solde -> HTTP ${res.status}`);
    return (await res.json()) as {
      total_balance: number;
      mtn_balance: number;
      orange_balance: number;
      currency: string;
    };
  }
}

/* ── utilitaires crypto, isoles pour rester testables ── */
import { createHmac, timingSafeEqual } from "node:crypto";

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Comparaison a temps constant. Jamais `==` sur une signature. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
