/**
 * Le client HTTP de l'app vendeuse.
 *
 * **Meme origine, toujours.** Les chemins sont relatifs : en developpement
 * comme en preproduction, Vite renvoie `/api` vers l'API. C'est ce qui permet au
 * cookie de session d'etre `SameSite` — un cookie tiers serait bloque par
 * defaut sur les navigateurs mobiles courants, et la vendeuse serait deconnectee
 * a chaque ouverture.
 *
 * **Les erreurs metier ne sont pas des exceptions.** Un code faux, un numero
 * deja pose, une limite de debit atteinte : ce sont des reponses, et l'ecran doit
 * afficher leur message. Seule une panne reseau leve.
 */

import type { StatsVendeuse } from "@catalog/contracts/stats";

export interface ReponseApi<T> {
  ok: boolean;
  statut: number;
  donnees: T | null;
  /** Message deja redige en francais simple par l'API. */
  message: string | null;
  erreur: string | null;
  /** Secondes a attendre, quand l'API en annonce. */
  reessayerDansSecondes?: number;
}

/** Panne reseau — a distinguer d'un refus metier. Les ecrans le disent. */
export class PanneReseau extends Error {
  constructor(cause: unknown) {
    super("reseau_indisponible", { cause });
    this.name = "PanneReseau";
  }
}

export async function appeler<T = unknown>(
  chemin: string,
  options: {
    methode?: "GET" | "POST" | "PATCH";
    corps?: unknown;
    /**
     * Corps envoye tel quel — `FormData` pour un televersement. On ne pose
     * SURTOUT pas `Content-Type` dessus : le navigateur y ajoute la frontiere
     * multipart, et l'ecrire a la main casse le decoupage cote serveur.
     */
    corpsBrut?: BodyInit;
  } = {},
): Promise<ReponseApi<T>> {
  let r: Response;
  try {
    r = await fetch(chemin, {
      method:
        options.methode ?? (options.corps !== undefined || options.corpsBrut ? "POST" : "GET"),
      // Le cookie de session doit accompagner chaque appel.
      credentials: "same-origin",
      ...(options.corpsBrut
        ? { body: options.corpsBrut }
        : options.corps !== undefined
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(options.corps),
            }
          : {}),
    });
  } catch (cause) {
    throw new PanneReseau(cause);
  }

  const brut = await r.text();
  let donnees: unknown = null;
  try {
    donnees = brut ? JSON.parse(brut) : null;
  } catch {
    donnees = null;
  }
  const objet = (donnees ?? {}) as Record<string, unknown>;

  return {
    ok: r.ok,
    statut: r.status,
    donnees: (donnees as T) ?? null,
    message: typeof objet.message === "string" ? objet.message : null,
    erreur: typeof objet.erreur === "string" ? objet.erreur : null,
    ...(typeof objet.reessayerDansSecondes === "number"
      ? { reessayerDansSecondes: objet.reessayerDansSecondes }
      : {}),
  };
}

/**
 * Message affichable pour une reponse en echec.
 *
 * L'API redige deja ses refus metier en francais simple ; on ne les reecrit pas
 * ici, sinon deux formulations divergeraient. Le repli sert aux erreurs que
 * Better Auth renvoie dans son propre format.
 */
export function messageDErreur(r: ReponseApi<unknown>, repli: string): string {
  if (r.message) return r.message;
  if (r.statut === 401) return repli;
  if (r.statut === 429) return "Trop de tentatives. Attendez un moment avant de reessayer.";
  if (r.statut >= 500) return "Le service ne repond pas. Reessayez dans un instant.";
  return repli;
}

/* ────────────────────────── points d'entree ────────────────────────── */

export interface Vendeuse {
  userId: string;
  loginPhone: string;
  seller: {
    id: string;
    businessName: string;
    slug: string;
    city: string;
    payoutPhone: string | null;
    payoutOperator: string | null;
  } | null;
}

export interface ImageArticle {
  avif: string;
  webp: string;
  largeur: number | null;
  hauteur: number | null;
  octets: number | null;
}

export interface Article {
  id: string;
  name: string;
  priceXaf: number;
  stock: number;
  position: number;
  archive: boolean;
  image: ImageArticle | null;
}

export interface ReponsePhoto {
  article: Article;
  image: {
    cle: string;
    largeur: number;
    hauteur: number;
    octets: number;
    octetsWebp: number;
    octetsRecus: number;
  };
}

/* ────────────────────────── commandes (lot 11) ────────────────────────── */

export type EtapeCommande = "recue" | "preparee" | "chez_le_livreur" | "livree";

export interface Commande {
  id: string;
  reference: string;
  acheteuse: { nom: string | null; telephone: string };
  totalXaf: number;
  dejaPayeXaf: number;
  resteXaf: number;
  modePaiement: string;
  etape: EtapeCommande;
  etatPreuve: string;
  modeLivraison: "livraison" | "retrait";
  livraison: unknown;
  codeVerification: string;
  annuleeA: string | null;
  creeA: string;
  /** Les etapes visables MAINTENANT. Calculees par le serveur, pas ici. */
  etapesPossibles: EtapeCommande[];
  soldeAEncaisserXaf: number;
  avisVerifiePossible: boolean;
}

export const api = {
  envoyerCodeConnexion: (phoneNumber: string) =>
    appeler("/api/auth/phone-number/send-otp", { corps: { phoneNumber } }),

  verifierCodeConnexion: (phoneNumber: string, code: string) =>
    appeler("/api/auth/phone-number/verify", {
      corps: { phoneNumber, code, disableSession: false },
    }),

  /* ── connexion par WhatsApp entrant — ADR 0027 ── */

  etatConnexionWhatsapp: () =>
    appeler<{ disponible: boolean; google?: boolean }>("/api/auth/connexion-whatsapp/etat"),

  /* ── ceremonie Google — ADR 0029 : redirection OAuth, aucun client en plus ── */

  commencerGoogle: (callbackURL: string) =>
    appeler<{ url?: string }>("/api/auth/sign-in/social", {
      corps: { provider: "google", callbackURL },
    }),

  creerDefiWhatsapp: () =>
    appeler<{ jeton: string; suivi: string; code: string; lien: string; expireDansS: number }>(
      "/api/auth/connexion-whatsapp/defi",
      { corps: {} },
    ),

  attenteDefiWhatsapp: (suivi: string) =>
    appeler<{ statut: "en_attente" | "verifie" | "inconnu" }>(
      `/api/auth/connexion-whatsapp/attente?suivi=${encodeURIComponent(suivi)}`,
    ),

  echangerDefiWhatsapp: (jeton: string) =>
    appeler<{ statut: "connecte" | "en_attente" | "inconnu" }>(
      "/api/auth/connexion-whatsapp/echanger",
      { corps: { jeton } },
    ),

  moi: () => appeler<Vendeuse>("/api/vendeuse/moi"),

  creerProfil: (businessName: string, city: string, contactPhone?: string) =>
    appeler("/api/vendeuse/profil", {
      corps: { businessName, city, ...(contactPhone ? { contactPhone } : {}) },
    }),

  envoyerCodeReversement: (nouveauNumero: string) =>
    appeler("/api/reversement/code", { corps: { nouveauNumero } }),

  changerReversement: (nouveauNumero: string, code: string) =>
    appeler<{ payoutPhone: string; payoutOperator: string | null }>("/api/reversement", {
      corps: { nouveauNumero, code },
    }),

  deconnexion: () => appeler("/api/auth/sign-out", { corps: {} }),

  /* ────────────────────────── catalogue ────────────────────────── */

  articles: (avecArchives = false) =>
    appeler<{ articles: Article[] }>(`/api/articles${avecArchives ? "?archives=1" : ""}`),

  creerArticle: (name: string, priceXaf: number) =>
    appeler<Article>("/api/articles", { corps: { name, priceXaf } }),

  modifierArticle: (id: string, champs: { name?: string; priceXaf?: number; stock?: number }) =>
    appeler<Article>(`/api/articles/${id}`, { methode: "PATCH", corps: champs }),

  archiverArticle: (id: string) => appeler<Article>(`/api/articles/${id}/archiver`, { corps: {} }),
  restaurerArticle: (id: string) =>
    appeler<Article>(`/api/articles/${id}/restaurer`, { corps: {} }),

  ordonnerArticles: (ids: string[]) =>
    appeler<{ articles: Article[] }>("/api/articles/ordre", { corps: { ids } }),

  /**
   * Televersement de la photo.
   *
   * Le corps est un `FormData` : on ne pose PAS `Content-Type` a la main, sinon
   * la frontiere multipart manque et le serveur ne peut pas decouper le corps.
   */
  envoyerPhoto: (id: string, fichier: File) => {
    const fd = new FormData();
    fd.set("photo", fichier);
    return appeler<ReponsePhoto>(`/api/articles/${id}/image`, { corpsBrut: fd });
  },

  /* ────────────────────────── commandes ────────────────────────── */

  commandes: () =>
    appeler<{ commandes: Commande[]; soldesAEncaisserXaf: number }>("/api/commandes"),

  avancerEtape: (id: string, vers: EtapeCommande) =>
    appeler<Commande>(`/api/commandes/${id}/etape`, { corps: { vers } }),

  /**
   * Le depot direct NON TRACE. Il fait avancer la commande et reste marque non
   * trace : pas de recu, pas d'avis verifie. L'ecran propose « j'ai le SMS » a
   * cote, qui mene au collage.
   */
  declarerPaiement: (id: string, montantXaf: number) =>
    appeler<Commande & { trace: boolean; aRendreXaf: number }>(
      `/api/commandes/${id}/paiement-declare`,
      { corps: { montantXaf } },
    ),

  /* ────────────────────────── statistiques (lot 13) ────────────────────────── */

  /**
   * Les chiffres de la vendeuse sur une fenetre glissante.
   *
   * Le type vient du CONTRAT et n'est pas redeclare ici : c'est la meme source
   * de verite que celle dont la route se sert pour serialiser. `import type`
   * disparait a la compilation, donc importer depuis `@catalog/contracts/stats`
   * ne fait entrer ni Zod ni ses effets de bord de module dans le paquet.
   */
  statistiques: (jours: number) => appeler<StatsVendeuse>(`/api/statistiques?jours=${jours}`),
};
