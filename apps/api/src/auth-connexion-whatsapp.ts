import { randomBytes } from "node:crypto";
import { normalizePhone } from "@catalog/contracts";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import {
  composerCodeDefi,
  construireLienWa,
  DUREE_DEFI_S,
  decisionEchange,
  type EtatDefi,
  extraireCodeDefi,
  numeroInternational,
} from "./domain/connexion-whatsapp.ts";

/**
 * Connexion par WhatsApp entrant — le branchement Better Auth. Voir l'ADR 0027.
 *
 * Quatre points d'entree, tous servis par le handler Better Auth deja monte
 * sur `/api/auth/*` — aucune route Hono nouvelle pour ce flux :
 *
 *   GET  /connexion-whatsapp/etat      le canal est-il configure ?
 *   POST /connexion-whatsapp/defi      cree un defi, rend le lien wa.me
 *   GET  /connexion-whatsapp/attente   sondage par `suivi` — ne revele qu'un statut
 *   POST /connexion-whatsapp/echanger  `jeton` (corps) contre une session
 *
 * La limitation de debit existante s'applique sans rien ajouter : les POST de
 * `/api/auth` sont sous la famille `ecriture`, le GET de sondage sous
 * `lecture` — c'est PRECISEMENT pour cela que le sondage a son propre
 * identifiant `suivi` et passe en GET (voir `domain/connexion-whatsapp.ts`).
 *
 * ── Le magasin : la table `authVerification`, rien de neuf ────────────────
 *
 * Un defi vit dans la table de verification de Better Auth, sous trois cles.
 * `consumeVerificationValue` est ATOMIQUE (trouve-et-supprime) : c'est lui qui
 * garantit l'usage unique — un message WhatsApp rejoue ne re-verifie rien, et
 * deux onglets qui echangent le meme jeton ne font qu'une session.
 */

const CLE_CODE = (code: string) => `conn-wa-code:${code}`;
const CLE_DEFI = (jeton: string) => `conn-wa-defi:${jeton}`;
const CLE_SUIVI = (suivi: string) => `conn-wa-suivi:${suivi}`;

/** Le sous-ensemble de l'adaptateur interne dont ce flux a besoin. */
export interface MagasinDefis {
  createVerificationValue(donnees: {
    identifier: string;
    value: string;
    expiresAt: Date;
  }): Promise<unknown>;
  findVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date } | null>;
  consumeVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date } | null>;
}

function lireEtat(brut: { value: string; expiresAt: Date } | null) {
  if (!brut) return null;
  try {
    return { valeur: JSON.parse(brut.value) as EtatDefi, expireA: brut.expiresAt };
  } catch {
    return null;
  }
}

/** Cree les trois enregistrements d'un defi neuf. */
export async function creerDefi(
  magasin: MagasinDefis,
  d: { code: string; jeton: string; suivi: string; maintenant: Date },
): Promise<void> {
  const expiresAt = new Date(d.maintenant.getTime() + DUREE_DEFI_S * 1000);
  const enAttente = JSON.stringify({ statut: "en_attente" } satisfies EtatDefi);
  await magasin.createVerificationValue({
    identifier: CLE_CODE(d.code),
    value: JSON.stringify({ jeton: d.jeton, suivi: d.suivi }),
    expiresAt,
  });
  await magasin.createVerificationValue({
    identifier: CLE_DEFI(d.jeton),
    value: enAttente,
    expiresAt,
  });
  await magasin.createVerificationValue({
    identifier: CLE_SUIVI(d.suivi),
    value: enAttente,
    expiresAt,
  });
}

/**
 * L'issue d'un message entrant, du point de vue de la connexion — ADR 0081.
 *
 * Elle est NOMMEE parce qu'elle se journalise : le defaut du 13/08 n'etait pas
 * qu'un message soit ignore, c'est qu'aucune trace ne disait lequel des quatre
 * chemins il avait pris. Aucune de ces valeurs ne porte de contenu — ni le
 * code, ni le numero, ni le texte (ADR 0023).
 */
export type IssueMessageEntrant =
  /** Pas de code dans le texte : le cas ordinaire, tout le trafic du bot. */
  | "sans_code"
  /** Un code, mais un `wa_id` inutilisable — un +237 malforme (ADR 0080). */
  | "numero_refuse"
  /** Un code, mais aucun defi vivant : inconnu, expire, ou deja consomme. */
  | "defi_inconnu"
  | "verifie";

/**
 * Ce que le webhook applique quand un message arrive.
 *
 * `consume` sur la cle du code d'abord : un code ne sert qu'une fois, et un
 * message rejoue par Meta — les relivraisons existent — tombe sur du vide.
 * Le numero vient du `wa_id` Meta, pas du texte : c'est Meta qui l'atteste.
 *
 * Ne leve jamais : le webhook repond toujours 200, et un code inconnu ou
 * expire n'est pas une erreur — c'est un message ordinaire. Il RAPPORTE en
 * revanche lequel des chemins il a pris, pour que l'appelant puisse le dire.
 */
export async function appliquerMessageEntrant(
  magasin: MagasinDefis,
  m: { de: string; texte: string; maintenant: Date },
): Promise<IssueMessageEntrant> {
  const code = extraireCodeDefi(m.texte);
  if (!code) return "sans_code";

  /* Hors Cameroun : la porte est OUVERTE — ADR 0080, decide le 13/08 par le
     porteur du produit. La diaspora vend au Cameroun, et c'est Meta qui
     atteste le numero (`wa_id`), la meme garantie que pour un +237. Un +237
     malforme reste refuse (il passe par `normalizePhone`, jamais par le
     guichet etranger), et le reversement, lui, demeure camerounais — les
     rails Mobile Money ne changent pas de pays. Le banc d'essai (ADR 0058)
     n'est plus necessaire ICI ; il reste pour le reversement de test. */
  const numero = normalizePhone(m.de) ?? numeroInternational(m.de);
  if (!numero) return "numero_refuse";

  const porteur = await magasin.consumeVerificationValue(CLE_CODE(code));
  if (!porteur) return "defi_inconnu";
  if (m.maintenant.getTime() >= porteur.expiresAt.getTime()) return "defi_inconnu";

  let cles: { jeton?: string; suivi?: string };
  try {
    cles = JSON.parse(porteur.value) as { jeton?: string; suivi?: string };
  } catch {
    return "defi_inconnu";
  }
  if (!cles.jeton || !cles.suivi) return "defi_inconnu";

  /**
   * « Mise a jour » = consommer puis recreer sous la meme cle, en GARDANT
   * l'echeance d'origine : verifier un defi ne le prolonge pas.
   */
  const verifie = JSON.stringify({ statut: "verifie", numero } satisfies EtatDefi);
  await magasin.consumeVerificationValue(CLE_DEFI(cles.jeton));
  await magasin.createVerificationValue({
    identifier: CLE_DEFI(cles.jeton),
    value: verifie,
    expiresAt: porteur.expiresAt,
  });
  await magasin.consumeVerificationValue(CLE_SUIVI(cles.suivi));
  await magasin.createVerificationValue({
    identifier: CLE_SUIVI(cles.suivi),
    value: verifie,
    expiresAt: porteur.expiresAt,
  });
  return "verifie";
}

/** Le sondage : lecture seule, par `suivi`. */
export async function consulterSuivi(
  magasin: MagasinDefis,
  suivi: string,
  maintenant: Date,
): Promise<"en_attente" | "verifie" | "inconnu"> {
  const d = decisionEchange(
    lireEtat(await magasin.findVerificationValue(CLE_SUIVI(suivi))),
    maintenant,
  );
  return d.decision;
}

/**
 * L'echange : le jeton contre le numero verifie, UNE fois.
 *
 * Lecture d'abord — un defi encore en attente ne doit pas etre consomme par le
 * sondage d'un client impatient. La consommation n'a lieu que si la lecture a
 * vu `verifie`, et le verdict final se prend sur l'ENREGISTREMENT CONSOMME :
 * entre les deux, un concurrent a pu passer, et c'est lui qui a gagne.
 */
export async function echangerDefi(
  magasin: MagasinDefis,
  jeton: string,
  maintenant: Date,
): Promise<{ decision: "en_attente" | "inconnu" } | { decision: "verifie"; numero: string }> {
  const lu = decisionEchange(
    lireEtat(await magasin.findVerificationValue(CLE_DEFI(jeton))),
    maintenant,
  );
  if (lu.decision !== "verifie") return { decision: lu.decision };

  const consomme = decisionEchange(
    lireEtat(await magasin.consumeVerificationValue(CLE_DEFI(jeton))),
    maintenant,
  );
  return consomme.decision === "verifie" ? consomme : { decision: "inconnu" };
}

/* ─────────────────────────── le plugin ─────────────────────────── */

export interface ConnexionWhatsAppOptions {
  /** Le numero WhatsApp de Catalog, E.164 ou chiffres. Absent = canal ferme. */
  waba?: string | undefined;
  /** L'adresse technique derivee du numero — injectee pour eviter un cycle avec auth.ts. */
  emailTechnique: (numero: string) => string;
  maintenant?: () => Date;
  /** L'aleatoire, injectable pour les tests. */
  aleatoire?: (octets: number) => Uint8Array;
  /**
   * La ceremonie Google est-elle configuree ? — ADR 0029. Porte par CE point
   * d'etat parce que l'ecran de connexion le consulte deja : un seul appel
   * decide des boutons a afficher, aucun bouton qui echoue au premier appui.
   */
  googleActif?: boolean | undefined;
}

export function connexionWhatsApp(options: ConnexionWhatsAppOptions) {
  const maintenant = options.maintenant ?? (() => new Date());
  const aleatoire = options.aleatoire ?? ((n: number) => new Uint8Array(randomBytes(n)));

  return {
    id: "connexion-whatsapp",
    endpoints: {
      etatConnexionWhatsApp: createAuthEndpoint(
        "/connexion-whatsapp/etat",
        { method: "GET" },
        async (ctx) =>
          ctx.json({ disponible: Boolean(options.waba), google: Boolean(options.googleActif) }),
      ),

      creerDefiWhatsApp: createAuthEndpoint(
        "/connexion-whatsapp/defi",
        { method: "POST" },
        async (ctx) => {
          if (!options.waba) {
            return ctx.json({ erreur: "canal_non_configure" }, { status: 503 });
          }
          const code = composerCodeDefi(aleatoire(6));
          const jeton = Buffer.from(aleatoire(24)).toString("base64url");
          const suivi = Buffer.from(aleatoire(16)).toString("base64url");
          await creerDefi(ctx.context.internalAdapter as unknown as MagasinDefis, {
            code,
            jeton,
            suivi,
            maintenant: maintenant(),
          });
          return ctx.json({
            jeton,
            suivi,
            code,
            lien: construireLienWa(options.waba, code),
            expireDansS: DUREE_DEFI_S,
          });
        },
      ),

      attenteConnexionWhatsApp: createAuthEndpoint(
        "/connexion-whatsapp/attente",
        { method: "GET", query: z.object({ suivi: z.string().min(8) }) },
        async (ctx) => {
          const statut = await consulterSuivi(
            ctx.context.internalAdapter as unknown as MagasinDefis,
            ctx.query.suivi,
            maintenant(),
          );
          return ctx.json({ statut });
        },
      ),

      echangerDefiWhatsApp: createAuthEndpoint(
        "/connexion-whatsapp/echanger",
        { method: "POST", body: z.object({ jeton: z.string().min(8) }) },
        async (ctx) => {
          const resultat = await echangerDefi(
            ctx.context.internalAdapter as unknown as MagasinDefis,
            ctx.body.jeton,
            maintenant(),
          );
          if (resultat.decision !== "verifie") {
            return ctx.json({ statut: resultat.decision });
          }

          /**
           * Miroir exact du plugin `phoneNumber` en `signUpOnVerification`
           * (better-auth/plugins/phone-number/routes) : recherche par numero,
           * creation au premier passage, marquage verifie ensuite, session,
           * cookie. On ne re-invente aucune de ces etapes.
           */
          const numero = resultat.numero;
          let utilisateur = (await ctx.context.adapter.findOne({
            model: "user",
            where: [{ field: "phoneNumber", value: numero }],
          })) as { id: string } | null;

          if (!utilisateur) {
            utilisateur = (await ctx.context.internalAdapter.createUser({
              email: options.emailTechnique(numero),
              name: numero,
              phoneNumber: numero,
              phoneNumberVerified: true,
            } as never)) as { id: string };
          } else {
            await ctx.context.internalAdapter.updateUser(utilisateur.id, {
              phoneNumberVerified: true,
            });
          }

          const session = await ctx.context.internalAdapter.createSession(utilisateur.id);
          await setSessionCookie(ctx, {
            session,
            user: utilisateur as never,
          });
          return ctx.json({ statut: "connecte" });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
