import { createHmac, timingSafeEqual } from "node:crypto";
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
 * Surface RELEVEE EN BAC A SABLE le 29/07/2026 sur `demo.campay.net`, avec une
 * application de demonstration reelle. Ce qui suit n'est plus deduit d'un SDK
 * tiers : chaque champ ci-dessous a ete observe dans une reponse verbatim.
 *
 *   POST /api/collect/                  -> { reference, ussd_code, operator }
 *   GET  /api/transaction/{ref}/        -> statut complet (voir StatusResponse)
 *   POST /api/history/                  -> { data: [...] }, start_date/end_date
 *   GET  /api/balance/                  -> solde, ventile MTN / Orange / utility
 *   POST /api/withdraw/                 -> reversement (NON teste : solde nul)
 *
 * Statuts observes : PENDING | SUCCESSFUL | FAILED.
 *
 * LIMITE STRUCTURELLE (inchangee, confirmee) : `collect` n'a pas de champ
 * beneficiaire. Les fonds atterrissent sur le solde du compte marchand et il
 * faut un `withdraw` pour les reverser — c'est le modele « compte marchand
 * unique » que l'ADR 0006 ecarte. A ne pas mettre en production sans reponse
 * ecrite sur un modele sous-marchand.
 */

const BASE = {
  PROD: "https://www.campay.net",
  DEV: "https://demo.campay.net",
} as const;

export interface CampayConfig {
  /** Jeton permanent (section APP KEYS). Envoye en `Authorization: Token …`. */
  permanentToken: string;
  environment: keyof typeof BASE;
  /** « Cle webhook de l'application » — cle HMAC du jeton `signature`. */
  webhookSecret?: string;
  fetchImpl?: typeof fetch;
  /** Injectable pour tester l'expiration du jeton sans horloge reelle. */
  nowSeconds?: () => number;
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
 * Codes d'erreur. ER101 et ER201 ont ete declenches et lus en bac a sable ;
 * ER102 et ER301 proviennent du wrapper PHP communautaire et n'ont PAS pu
 * etre reproduits (aucun numero Camtel accepte a l'appel, solde nul).
 */
export const CAMPAY_ERRORS = {
  ER101: "numero invalide — refuse par CamPay (« Invalid phone number »)",
  ER102: "operateur non supporte — seuls MTN et Orange sont acceptes",
  ER201: "montant invalide — decimale, zero, ou sous le minimum de l'operateur",
  ER301: "solde insuffisant pour le reversement (flottant epuise)",
} as const;

export type CampayErrorCode = keyof typeof CAMPAY_ERRORS;

/**
 * Minimums par operateur OBSERVES le 29/07/2026 : un collect de 5 XAF passe
 * chez MTN et renvoie ER201 « Minimum amount for Orange is 10.00 » chez
 * Orange. On ne bloque PAS cote client — CamPay reste l'autorite, et un
 * minimum code en dur deviendrait faux le jour ou il change. C'est une note
 * pour le dimensionnement des montants de test, pas une regle applicative.
 */
export const CAMPAY_OBSERVED_MINIMUM_XAF = { mtn: 5, orange: 10 } as const;

export class CampayError extends Error {
  constructor(
    readonly code: CampayErrorCode | "UNKNOWN",
    message: string,
    readonly httpStatus?: number,
    /** Message brut de CamPay — porte le detail utile, ex. le minimum exact. */
    readonly providerMessage?: string,
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
    return new CampayError(code, CAMPAY_ERRORS[code], httpStatus, p?.message);
  }
  return new CampayError(
    "UNKNOWN",
    p?.message ?? `HTTP ${httpStatus ?? "?"}`,
    httpStatus,
    p?.message,
  );
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

/**
 * CamPay renvoie les montants en chaine decimale (« 5.00 ») sur le statut, et
 * en nombre sur l'historique. Le FCFA n'a pas de sous-unite : une partie
 * decimale non nulle est une anomalie de contrat, pas un arrondi a absorber
 * en silence. On echoue bruyamment plutot que de deformer un montant.
 */
export function parseXafAmount(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`montant CamPay illisible: ${JSON.stringify(raw)}`);
  }
  if (!Number.isInteger(n)) {
    throw new Error(`montant XAF non entier renvoye par CamPay: ${JSON.stringify(raw)}`);
  }
  return n;
}

/** Reponse de POST /api/collect/ — observee : exactement ces trois champs. */
interface CollectResponse {
  reference: string;
  ussd_code?: string;
  operator?: string;
}

/**
 * Reponse de GET /api/transaction/{ref}/ — releve verbatim en bac a sable.
 * `operator_reference` est une CHAINE VIDE, jamais absente, quand CamPay ne
 * la connait pas.
 */
interface StatusResponse {
  reference: string;
  status: string;
  amount: string;
  currency: string;
  operator: string;
  /** Code interne CamPay, ex. « D260729D0053YC ». Ce n'est PAS la ref SMS. */
  code: string;
  /** Reference de l'OPERATEUR. Voir la note sur checkStatus. */
  operator_reference: string;
  endpoint: string;
  /** Jeton JWT — voir verifySignature. */
  signature: string;
  external_reference: string;
  external_user: string;
  extra_first_name: string;
  extra_last_name: string;
  extra_email: string;
  /** Montant net apres commission CamPay. */
  app_amount: string;
  phone_number: string;
  redirect_url: string;
  failure_redirect_url: string;
  description: string;
  /** « None » quand il n'y a rien a dire ; sinon PAYEE_NOT_FOUND, etc. */
  reason: string;
  [k: string]: unknown;
}

/**
 * Ligne de POST /api/history/. A noter : il n'y a PAS de `external_reference`
 * ici — notre reference de commande ne voyage pas jusqu'a l'historique, seul
 * `reference_uuid` permet le rapprochement.
 */
export interface CampayHistoryRow {
  datetime: string;
  code: string;
  /** Meme valeur que `operator_reference` du statut, sous un autre nom. */
  operator_tx_code: string | null;
  operator: string;
  phone_number: string;
  description: string;
  external_user: string;
  amount: number;
  charge_amount: number;
  debit: number;
  credit: number;
  status: string;
  reference_uuid: string;
}

export class CampayProvider implements PaymentProvider {
  readonly name = "campay";
  readonly #base: string;
  readonly #token: string;
  readonly #secret: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(cfg: CampayConfig) {
    this.#base = BASE[cfg.environment];
    this.#token = cfg.permanentToken;
    this.#secret = cfg.webhookSecret;
    this.#fetch = cfg.fetchImpl ?? fetch;
    this.#now = cfg.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
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

  /**
   * Seule source d'autorite sur le statut.
   *
   * `operator_reference` EXISTE et porte bien la reference de l'operateur —
   * observe en bac a sable : « 18132148736 » (11 chiffres, format du SMS MTN)
   * et « MP260729.1716.C73941 » (format Orange Money). C'est la reponse a la
   * question qui bloquait l'ADR 0008.
   *
   * MAIS elle n'est pas toujours renseignee : le bac a sable l'a laissee vide
   * sur ses transactions SUCCESSFUL simulees. On ne peut donc PAS en faire une
   * dependance dure tant que le comportement en production n'est pas confirme.
   * La chaine vide est traitee comme une absence.
   */
  async checkStatus(providerTxId: string): Promise<StatusResult> {
    const res = await this.#fetch(`${this.#base}/api/transaction/${providerTxId}/`, {
      headers: { Authorization: `Token ${this.#token}` },
    });
    if (!res.ok) throw new Error(`campay statut -> HTTP ${res.status}`);
    const r = (await res.json()) as StatusResponse;
    const out: StatusResult = { status: mapStatus(r.status), raw: r };
    if (r.amount !== undefined && r.amount !== null) {
      out.amountXaf = parseXafAmount(r.amount);
    }
    // Chaine vide = CamPay ne la connait pas. Ne jamais la propager telle quelle.
    if (typeof r.operator_reference === "string" && r.operator_reference !== "") {
      out.operatorRef = r.operator_reference;
    }
    return out;
  }

  /**
   * Authentifie l'ORIGINE d'une notification. Ne dit RIEN de son contenu.
   *
   * Schema releve et verifie cryptographiquement le 29/07/2026 : CamPay place
   * un JWT dans le champ `signature` du CORPS (aucun en-tete de signature n'a
   * ete observe). L'algorithme est HS256 et la cle HMAC est la « Cle webhook
   * de l'application ». Verification faite octet par octet sur trois
   * transactions reelles.
   *
   * DANGER, et c'est la raison d'etre de la regle « le webhook n'est jamais
   * une preuve » : la charge utile du JWT ne contient QUE `iat`, `nbf`, `exp`
   * et `source: "CamPay"`. Elle ne lie ni la reference, ni le montant, ni le
   * statut. Deux transactions differentes emises dans la meme seconde ont
   * produit un jeton BYTE POUR BYTE IDENTIQUE. Ce jeton est donc un porteur
   * rejouable pendant une heure : quiconque en capture un peut l'agrafer a
   * une charge utile forgee. Un `true` ici autorise seulement a dire « CamPay
   * a emis un jeton recemment » — jamais « ce paiement a eu lieu ». Le statut
   * ne s'etablit que par `checkStatus`.
   *
   * Reste non observe : la forme exacte du corps du webhook. Le champ
   * `signature` est present dans la reponse de statut, ou il n'a aucune
   * utilite pour un appel authentifie en TLS — sa seule raison d'etre est
   * d'accompagner une notification poussee. La verification echoue de toute
   * facon en silence si le corps reel differe : rien n'avance sans elle.
   */
  verifySignature(rawBody: string, _headers: Record<string, string>): boolean {
    if (!this.#secret) return false;
    let token: unknown;
    try {
      token = (JSON.parse(rawBody) as { signature?: unknown }).signature;
    } catch {
      return false; // corps non JSON : rien a verifier
    }
    if (typeof token !== "string") return false;
    return verifyCampayToken(this.#secret, token, this.#now()).ok;
  }

  /**
   * Reversement vers le numero de la vendeuse. NON teste : le compte de
   * demonstration a un solde nul, donc ER301 n'a pas pu etre reproduit.
   * A n'utiliser QUE si un modele sous-marchand n'est pas disponible.
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
   * Historique sur une periode. Endpoint CONFIRME en bac a sable : il repond
   * 200 avec `{ data: [...] }`.
   *
   * Deux limites observees, qui l'empechent de servir de journal de reprise :
   * les transactions PENDING n'y figurent PAS, et il n'y a pas de champ
   * `external_reference` — notre reference de commande ne voyage pas jusqu'ici.
   */
  async history(range?: { startDate: string; endDate: string }) {
    const body = range ? { start_date: range.startDate, end_date: range.endDate } : {};
    return this.#post<{ data: CampayHistoryRow[] }>("/api/history/", body);
  }

  /**
   * CamPay ventile son solde par operateur. Un solde MTN a zero fait echouer
   * les reversements vers MTN sans que rien ne le signale cote metier :
   * a surveiller, avec une alerte sous seuil. Les deux champs `utility_*` ont
   * ete observes en plus de ceux attendus.
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
      utility_balance?: number;
      utility_commission_balance?: number;
    };
  }
}

/* ── verification du jeton, isolee pour rester testable ── */

export interface TokenVerdict {
  ok: boolean;
  /** Motif du refus, pour le journal. Jamais expose a l'appelant HTTP. */
  reason: "ok" | "malformed" | "unsupported_alg" | "bad_signature" | "expired" | "not_yet_valid";
}

/**
 * Verifie un JWT HS256 CamPay. Tolerance d'horloge de 60 s par defaut :
 * les serveurs derivent, et un refus pour 2 s d'ecart bloquerait un paiement.
 */
export function verifyCampayToken(
  secret: string,
  token: string,
  nowSeconds: number,
  skewSeconds = 60,
): TokenVerdict {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [encHeader, encPayload, encSignature] = parts as [string, string, string];

  let header: { alg?: unknown };
  let payload: { exp?: unknown; nbf?: unknown };
  try {
    header = JSON.parse(Buffer.from(encHeader, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(encPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // `alg: none` et la confusion d'algorithme sont refusees d'office.
  if (header.alg !== "HS256") return { ok: false, reason: "unsupported_alg" };

  const expected = createHmac("sha256", secret)
    .update(`${encHeader}.${encPayload}`)
    .digest("base64url");
  if (!timingSafeEqualStr(encSignature, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  // Signature valide : seulement maintenant on lit les bornes temporelles.
  if (typeof payload.exp === "number" && nowSeconds > payload.exp + skewSeconds) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.nbf === "number" && nowSeconds < payload.nbf - skewSeconds) {
    return { ok: false, reason: "not_yet_valid" };
  }
  return { ok: true, reason: "ok" };
}

/** Comparaison a temps constant. Jamais `==` sur une signature. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
