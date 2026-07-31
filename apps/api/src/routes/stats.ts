import type { ArticleVu, PointSerie, StatsVendeuse } from "@catalog/contracts";
import type { PrismaClient } from "@catalog/db";
import { Hono } from "hono";
import { fenetreGlissante, jourDeColonneDate, jourDeDouala } from "../domain/stats/periode.ts";
import { type Entonnoir, etapesEntonnoir, serieContinue } from "../domain/stats/serie.ts";
import { pourcentProuve, repartirComptes } from "../domain/stats/ventes-prouvees.ts";
import { type SessionDeps, vendeuseCourante } from "./seller.ts";

/**
 * L'ecran statistiques, cote serveur. Route MINCE : elle lit, delegue au
 * domaine, serialise.
 *
 * Elle ne calcule AUCUN taux et AUCUNE part. La repartition des ventes, le
 * comblement des jours creux et les taux d'etape a etape vivent dans
 * `src/domain/stats`, ou ils se testent sans base — c'est la raison d'etre de la
 * regle de dependance, et c'est aussi ce qui fait que les cas penibles (aucune
 * vente, un seul jour, une etape qui remonte) sont couverts.
 *
 * **Une vendeuse ne voit que ses propres chiffres.** Chaque requete est filtree
 * par `sellerId` resolu depuis la session, jamais depuis un parametre : un
 * identifiant de boutique dans l'URL serait un numero a essayer.
 *
 * ## Ce que cette route NE fait pas
 *
 * Elle ne rend pas de « sources de trafic ». Rien dans le systeme n'enregistre
 * d'ou vient une visite : ni referent, ni parametre de campagne, ni table pour
 * les recevoir. Inventer un graphique la-dessus serait combler une information
 * manquante par une valeur plausible, ce qu'AGENTS.md §7.7 interdit. C'est
 * signale et laisse ouvert — voir l'ADR 0022.
 */

/** Fenetres proposees. Une liste fermee : `?jours=100000` n'est pas une periode. */
export const FENETRES = [7, 30, 90] as const;
export type Fenetre = (typeof FENETRES)[number];
const FENETRE_PAR_DEFAUT: Fenetre = 30;

/**
 * `product_view` n'est alimentee par aucun chemin de code de la v1.
 *
 * La boutique publique est un site statique servi par un CDN : elle ne parle pas
 * a l'API en dehors de la rampe de paiement, et personne ne compte ses pages
 * vues. Les seules lignes qui existent viennent du jeu de donnees de
 * developpement.
 *
 * Ce drapeau voyage jusqu'a l'ecran, qui le dit en toutes lettres. Sans lui, une
 * vendeuse lirait « 0 vue » comme « personne ne regarde ma boutique » — un
 * chiffre faux est pire qu'un chiffre absent, parce qu'on agit dessus.
 *
 * `stats-instrumentation.test.ts` verifie qu'aucune route et aucun job n'ecrit
 * dans cette table. Le jour ou l'un le fera, ce test echouera, et c'est la que
 * cette constante passera a `true`.
 */
export const VUES_INSTRUMENTEES = false;

export interface StatsDeps {
  prisma: PrismaClient;
  session: SessionDeps;
  /** Injectee pour rester testable : le domaine recoit l'instant en parametre. */
  maintenant?: () => Date;
}

/** Nombre de jours demande, ramene a une valeur de la liste fermee. */
export function fenetreDemandee(brut: string | undefined): Fenetre {
  const n = Number(brut);
  return (FENETRES as readonly number[]).includes(n) ? (n as Fenetre) : FENETRE_PAR_DEFAUT;
}

export function statsRoutes(deps: StatsDeps) {
  const now = () => deps.maintenant?.() ?? new Date();

  return new Hono().get("/", async (c) => {
    const v = await vendeuseCourante(deps.session, c.req.raw);
    if (!v) return c.json({ erreur: "non_authentifiee" }, 401);
    if (!v.seller) return c.json({ erreur: "profil_absent" }, 409);

    const sellerId = v.seller.id;
    const f = fenetreGlissante(now(), fenetreDemandee(c.req.query("jours")));
    const dansLaFenetre = { gte: f.debut, lt: f.fin };

    /**
     * Les jours de `product_view` sont des colonnes SQL `DATE` : sans fuseau,
     * rendues a minuit UTC. On les borne donc en UTC et on les lit tels quels
     * — leur appliquer le decalage de Douala les ferait basculer au lendemain.
     */
    const jours = {
      gte: new Date(`${f.du}T00:00:00Z`),
      lte: new Date(`${f.au}T00:00:00Z`),
    };

    const [parEtat, payees, creations, vues] = await Promise.all([
      deps.prisma.order.groupBy({
        by: ["proofState"],
        where: { sellerId, createdAt: dansLaFenetre },
        _count: { _all: true },
      }),
      deps.prisma.order.count({
        where: { sellerId, createdAt: dansLaFenetre, amountPaidXaf: { gt: 0 } },
      }),
      /**
       * Les dates de creation brutes, regroupees en JavaScript.
       *
       * PostgreSQL regrouperait mieux, mais il faudrait lui donner le fuseau —
       * `date_trunc('day', created_at AT TIME ZONE 'Africa/Douala')` — donc du
       * SQL brut, donc une deuxieme definition du jour de Douala a cote de celle
       * du domaine. Deux definitions d'un jour finissent toujours par diverger
       * d'une heure, et c'est le genre d'ecart qu'on met une semaine a voir.
       * Le volume est borne par la fenetre : au plus les commandes d'une
       * vendeuse sur quatre-vingt-dix jours.
       */
      deps.prisma.order.findMany({
        where: { sellerId, createdAt: dansLaFenetre },
        select: { createdAt: true },
      }),
      deps.prisma.productView.findMany({
        where: { product: { sellerId }, day: jours },
        select: { day: true, count: true, productId: true, product: { select: { name: true } } },
      }),
    ]);

    /* ── part des ventes prouvees ── */
    const part = repartirComptes(
      parEtat.map((g) => ({ etat: g.proofState, nombre: g._count._all })),
    );

    /* ── series par jour, trous combles a zero par le domaine ── */
    const vuesParJour: PointSerie[] = serieContinue(
      vues.map((v_) => ({ jour: jourDeColonneDate(v_.day), valeur: v_.count })),
      f.du,
      f.au,
    );
    const commandesParJour: PointSerie[] = serieContinue(
      creations.map((o) => ({ jour: jourDeDouala(o.createdAt), valeur: 1 })),
      f.du,
      f.au,
    );

    /* ── entonnoir ── */
    const entonnoir: Entonnoir = {
      vues: vuesParJour.reduce((s, p) => s + p.valeur, 0),
      commandes: creations.length,
      payees,
      prouvees: part.prouve + part.contresigne,
    };

    /* ── articles les plus vus ── */
    const parArticle = new Map<string, ArticleVu>();
    for (const v_ of vues) {
      const vu = parArticle.get(v_.productId);
      if (vu) vu.vues += v_.count;
      else parArticle.set(v_.productId, { id: v_.productId, nom: v_.product.name, vues: v_.count });
    }
    const articlesLesPlusVus = [...parArticle.values()]
      .sort((a, b) => b.vues - a.vues || a.nom.localeCompare(b.nom, "fr"))
      .slice(0, 5);

    const reponse: StatsVendeuse = {
      periode: { du: f.du, au: f.au, jours: f.jours },
      partVentesProuvees: { ...part, pourcent: pourcentProuve(part) },
      vuesParJour,
      commandesParJour,
      entonnoir: etapesEntonnoir(entonnoir),
      articlesLesPlusVus,
      instrumentation: { vuesInstrumentees: VUES_INSTRUMENTEES },
    };
    return c.json(reponse);
  });
}
