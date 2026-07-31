import type { MiddlewareHandler } from "hono";
import {
  elaguer,
  type FamilleDeRoute,
  type Passage,
  REGLES_PAR_DEFAUT,
  type RegleDeDebit,
  secondesAvantReprise,
  verifierDebit,
} from "../domain/securite/debit.ts";
import { adresseDe } from "./otp-rate-limit.ts";

/**
 * La limitation de debit des routes publiques, en couche HTTP.
 *
 * ── Ce que ce garde vaut, et ce qu'il ne vaut pas ──────────────────────────
 *
 * **Le compteur vit dans la memoire du processus.** Consequence a dire tout
 * haut plutot qu'a decouvrir : avec N instances derriere un repartiteur, la
 * limite effective est N fois celle qui est ecrite. Ce n'est pas un oubli, c'est
 * un arbitrage — un compteur partage demanderait un Redis, donc une dependance
 * de plus a exploiter, a sauvegarder et a surveiller, pour une v1 qui tient sur
 * une instance. Le jour ou l'on passe a deux, ce module est le seul a changer,
 * et le runbook de lancement le dit.
 *
 * Ce que ce garde empeche vraiment : qu'UNE machine parcoure l'espace des codes
 * de verification, martele la contre-signature, ou fasse tourner l'analyseur de
 * SMS en boucle. Ce qu'il n'empeche pas : une attaque repartie sur mille
 * adresses — aucune limitation applicative ne le fait, c'est le role du reseau
 * de bordure.
 *
 * ── Pourquoi les routes sous session vendeuse n'y sont pas ─────────────────
 *
 * Une limite par adresse enfermerait dehors des vendeuses legitimes : au
 * Cameroun, la traduction d'adresses des operateurs mobiles fait sortir
 * plusieurs personnes par une meme adresse publique. C'est deja le risque connu
 * de la limite par adresse du lot 4, et il ne se prend pas deux fois. Seule
 * exception : **le collage de SMS**, parce que c'est le seul point d'entree ou
 * l'on peut ESSAYER quelque chose — forger des identifiants jusqu'a en trouver
 * un qui passe — et parce que sa limite (trente par minute) est trente fois
 * au-dessus de l'usage reel d'une vendeuse.
 */

/* ────────────────────────── quelle regle pour quel chemin ────────────────────────── */

/**
 * La famille d'une requete, ou `null` quand elle n'est pas limitee ici.
 *
 * `/health` et `/api/statut` sont EXEMPTS : ce sont les points d'entree qu'une
 * supervision interroge toutes les dix secondes, et les limiter reviendrait a
 * declarer le service en panne parce qu'on le surveille.
 */
export function familleDe(methode: string, chemin: string): FamilleDeRoute | null {
  if (chemin.startsWith("/health") || chemin.startsWith("/api/statut")) return null;

  // Le collage de SMS, sous session mais borne : voir l'en-tete du module.
  if (methode === "POST" && /^\/api\/commandes\/[^/]+\/preuve$/.test(chemin)) return "preuve";

  /**
   * L'accuse de livraison d'Orange, sous la famille `lecture` et non `ecriture`.
   *
   * Le calcul, parce qu'il se verifie : le plafond journalier global d'OTP est
   * de 2 000. Meme si les 2 000 accuses arrivaient dans la meme heure, cela
   * ferait 33 par minute — trois fois sous les 120 de la famille `lecture`, et
   * douze fois AU-DESSUS des 10 de la famille `ecriture`, qui les jetterait.
   *
   * Ce n'est pas une ecriture au sens du produit : la route n'ouvre aucune
   * transaction et ne touche pas la base. Ce qu'on borne ici, c'est la
   * recherche du secret par force brute.
   */
  if (chemin.startsWith("/api/sms/")) return "lecture";

  const publique =
    chemin.startsWith("/api/rampe") ||
    chemin.startsWith("/api/recu") ||
    chemin.startsWith("/api/suivi") ||
    chemin.startsWith("/api/auth");
  if (!publique) return null;

  // La recherche par identifiant d'operateur est sous session mais reste une
  // lecture publique du point de vue du debit : elle enumere si on la laisse.
  return methode === "GET" || methode === "HEAD" ? "lecture" : "ecriture";
}

/* ────────────────────────── le compteur ────────────────────────── */

/**
 * Les passages recents, en memoire, avec elagage.
 *
 * L'elagage est declenche par les ECRITURES et non par une minuterie : un
 * processus sans trafic n'a rien a elaguer, et une minuterie l'empecherait de
 * s'endormir. Le seuil est la plus large des fenetres configurees, jamais une
 * constante — sinon une fenetre allongee par configuration verrait ses passages
 * effaces trop tot, et la limite deviendrait plus permissive que ce qui est
 * ecrit.
 */
export class MemoireDeDebit {
  private passages: Passage[] = [];
  private readonly plusLargeFenetreMs: number;
  /** Elagage tous les N enregistrements : filtrer a chaque appel serait quadratique. */
  private depuisElagage = 0;

  constructor(regles: Record<FamilleDeRoute, RegleDeDebit>) {
    this.plusLargeFenetreMs = Math.max(...Object.values(regles).map((r) => r.fenetreMs));
  }

  recents(): readonly Passage[] {
    return this.passages;
  }

  enregistrer(cle: string, at: Date): void {
    this.passages.push({ cle, at });
    this.depuisElagage += 1;
    if (this.depuisElagage >= 256) {
      this.depuisElagage = 0;
      this.passages = elaguer(this.passages, new Date(at.getTime() - this.plusLargeFenetreMs));
    }
  }

  /** Pour les tests, et pour un redemarrage a chaud. */
  vider(): void {
    this.passages = [];
    this.depuisElagage = 0;
  }
}

/* ────────────────────────── le garde ────────────────────────── */

export interface OptionsDebit {
  regles?: Record<FamilleDeRoute, RegleDeDebit>;
  memoire?: MemoireDeDebit;
  maintenant?: () => Date;
}

export function limiterDebit(options: OptionsDebit = {}): MiddlewareHandler {
  const regles = options.regles ?? REGLES_PAR_DEFAUT;
  const memoire = options.memoire ?? new MemoireDeDebit(regles);

  return async (c, next) => {
    const famille = familleDe(c.req.method, new URL(c.req.url).pathname);
    if (!famille) return next();

    const now = options.maintenant?.() ?? new Date();
    /**
     * La cle porte la FAMILLE en plus de l'adresse. Sans elle, une acheteuse qui
     * rafraichit sa page de suivi consommerait le budget de sa propre
     * contre-signature — et le geste unique du produit echouerait a cause d'une
     * lecture anodine.
     */
    const cle = `${famille}:${adresseDe(c)}`;
    const decision = verifierDebit(memoire.recents(), { cle, now }, regles[famille]);

    if (!decision.autorise) {
      const secondes = secondesAvantReprise(decision);
      c.header("Retry-After", String(secondes));
      return c.json(
        {
          erreur: "trop_de_requetes",
          message: "Trop de requêtes depuis cet appareil. Patientez un instant.",
          reessayerDansSecondes: secondes,
        },
        429,
      );
    }

    // Enregistre AVANT d'executer : une requete lente ne doit pas ouvrir une
    // fenetre pendant laquelle mille autres passent sans etre comptees.
    memoire.enregistrer(cle, now);
    await next();
  };
}
