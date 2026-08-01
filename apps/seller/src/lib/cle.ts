/**
 * Passkeys cote vendeuse — ADR 0028.
 *
 * TOUT est charge paresseusement : le client Better Auth et le plugin passkey
 * n'entrent dans le paquet initial d'aucun ecran. Une vendeuse qui n'active
 * jamais sa cle ne telecharge jamais ce code.
 *
 * Le serveur peut avoir le canal FERME (pas de PASSKEY_RP_ID — voir
 * .env.example : le rpId est epingle au domaine definitif). L'app le detecte
 * par la sonde `serveurCleActif` : 404 = plugin absent, et aucun ecran ne
 * propose quoi que ce soit. Meme geste que le canal WhatsApp entrant.
 */

const INDICE_CLE = "catalog:cle";
const INDICE_PROPOSITION = "catalog:cle-proposee";

/** Le navigateur sait-il faire ? (WebAuthn present) */
export function webAuthnDisponible(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

/**
 * Une cle a-t-elle ete enrolee DEPUIS CE NAVIGATEUR ? Simple indice local :
 * il decide seulement d'afficher le bouton « empreinte » en premier. S'il ment
 * — stockage efface, cle revoquee —, la tentative echoue proprement et les
 * autres chemins de connexion sont juste en dessous.
 */
export function clePresumee(): boolean {
  try {
    return localStorage.getItem(INDICE_CLE) === "oui";
  } catch {
    return false;
  }
}

function marquerCle(): void {
  try {
    localStorage.setItem(INDICE_CLE, "oui");
  } catch {
    /* stockage indisponible : l'indice est un confort, pas une donnee */
  }
}

/** La proposition d'enrolement ne se fait qu'UNE fois. Jamais un peage. */
export function propositionDejaFaite(): boolean {
  try {
    return localStorage.getItem(INDICE_PROPOSITION) === "oui";
  } catch {
    return true; // sans stockage, ne jamais harceler
  }
}

export function marquerProposition(): void {
  try {
    localStorage.setItem(INDICE_PROPOSITION, "oui");
  } catch {
    /* voir plus haut */
  }
}

/** Ou aller apres une connexion reussie : proposer la cle, une fois. */
export function destinationApresConnexion(): string {
  return webAuthnDisponible() && !clePresumee() && !propositionDejaFaite() ? "/cle" : "/";
}

/* ───────────────── le client, charge a la demande ───────────────── */

interface ClientCle {
  signIn: { passkey: (opts?: object) => Promise<{ error?: { message?: string } | null } | null> };
  passkey: {
    addPasskey: (opts?: object) => Promise<{ error?: { message?: string } | null } | null>;
  };
}

let clientPromis: Promise<ClientCle> | null = null;

function client(): Promise<ClientCle> {
  if (!clientPromis) {
    clientPromis = Promise.all([
      import("better-auth/client"),
      import("@better-auth/passkey/client"),
    ]).then(
      ([{ createAuthClient }, { passkeyClient }]) =>
        createAuthClient({ plugins: [passkeyClient()] }) as unknown as ClientCle,
    );
  }
  return clientPromis;
}

/** Le plugin est-il monte cote serveur ? A appeler CONNECTEE (sinon 401). */
export async function serveurCleActif(): Promise<boolean> {
  try {
    const r = await fetch("/api/auth/passkey/list-user-passkeys", { credentials: "include" });
    return r.status !== 404;
  } catch {
    return false;
  }
}

/** Enrole l'appareil courant. La feuille biometrique du systeme fait le reste. */
export async function scellerAppareil(): Promise<"ok" | "refus"> {
  const c = await client();
  const r = await c.passkey.addPasskey({ name: nomDeCetAppareil() });
  if (r?.error) return "refus"; // geste annule, verrou absent… : jamais une erreur bloquante
  marquerCle();
  return "ok";
}

/** Connexion par la cle. `false` = echec ou annulation : les replis sont a l'ecran. */
export async function seConnecterAvecCle(): Promise<boolean> {
  const c = await client();
  const r = await c.signIn.passkey();
  if (r?.error) return false;
  marquerCle();
  return true;
}

export interface CleEnrolee {
  id: string;
  name: string | null;
  createdAt: string | null;
  backedUp: boolean;
  aaguid: string | null;
}

/** Les cles du compte — pour l'ecran « Appareils ». */
export async function listerCles(): Promise<CleEnrolee[]> {
  const r = await fetch("/api/auth/passkey/list-user-passkeys", { credentials: "include" });
  if (!r.ok) throw new Error(`liste des cles : HTTP ${r.status}`);
  const corps = (await r.json()) as unknown;
  const brutes = Array.isArray(corps)
    ? corps
    : ((corps as { passkeys?: unknown[] })?.passkeys ?? []);
  return (brutes as Array<Record<string, unknown>>).map((p) => ({
    id: String(p.id ?? ""),
    name: typeof p.name === "string" ? p.name : null,
    createdAt: typeof p.createdAt === "string" ? p.createdAt : null,
    backedUp: p.backedUp === true,
    aaguid: typeof p.aaguid === "string" ? p.aaguid : null,
  }));
}

/** Revoque une cle : l'appareil qui la portait ne peut plus se connecter. */
export async function revoquerCle(id: string): Promise<void> {
  const r = await fetch("/api/auth/passkey/delete-passkey", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!r.ok) throw new Error(`revocation : HTTP ${r.status}`);
}

/** Un nom lisible pour la liste — jamais requis, jamais bloquant. */
function nomDeCetAppareil(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const m = /Android[^;)]*; ([^;)]+)[;)]/.exec(ua);
  return m?.[1]?.trim() || "Ce telephone";
}
