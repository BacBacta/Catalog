import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrismaClient, type PrismaClient } from "@catalog/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeDb } from "./_base.ts";
import { identifiants } from "./_identifiants.ts";
import { compteur, SEUIL_PRINCIPAL, tableauMarkdown } from "./harnais/couverture.ts";
import { gestesDeLEtape, RECETTES } from "./harnais/etapes-scene.ts";
import { neutraliser } from "./harnais/instantane.ts";
import {
  creerScene,
  pilote,
  poserEtape,
  reinitialiserScene,
  type Scene,
  type Tour,
} from "./harnais/pilote.ts";
import { poserInstantanes } from "./harnais/poser.ts";

/**
 * Le BALAYAGE SYSTEMATIQUE — audit de pipeline, phases 3 et 7.
 *
 * Vingt-deux gestes sur chacune des vingt-deux etapes des deux parcours. C'est
 * ce fichier qui produit le CHIFFRE de couverture : pas une declaration, une
 * mesure, avec un denominateur pose d'avance dans `couverture.ts`.
 *
 * ── Ce qu'il etablit, et ce qu'il n'etablit pas ───────────────────────────
 *
 * Il etablit qu'une case a ete JOUEE, et ce que la personne a recu en retour.
 * Il n'etablit pas que la reponse est BONNE — c'est le travail des scenarios de
 * parcours et de la lecture du rapport. Une case exercee qui rend une reponse
 * absurde reste une case exercee : le tableau mesure la couverture, pas la
 * qualite. Confondre les deux serait refaire le defaut n° 4 de l'audit v1.
 *
 * ── Le fichier de constats ────────────────────────────────────────────────
 *
 * Le balayage ecrit `harnais/instantanes/balayage-muets.md` : toutes les cases
 * ou la personne n'a RIEN recu. C'est la matiere premiere de la famille
 * « silence », et elle est produite par execution, jamais par lecture.
 */

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ICI, "harnais", "instantanes");

let prisma: PrismaClient;
const ids = identifiants("harnais-balayage");
const compte = compteur();

interface CaseJouee {
  etape: string;
  famille: string;
  libelle: string;
  muet: boolean;
  etapeApres: string;
  premiereReponse: string;
}

const jouees: CaseJouee[] = [];

/** La premiere reponse, en une ligne — de quoi juger sans ouvrir l'instantane. */
function resume(tour: Tour, scene: Scene): string {
  const m = tour.messages[0];
  if (!m) return "";
  const x = m as {
    type: string;
    text?: { body?: string };
    interactive?: { body?: { text?: string } };
  };
  const corps = x.text?.body ?? x.interactive?.body?.text ?? `(${x.type})`;
  return neutraliser(corps, scene).split("\n")[0]?.slice(0, 110) ?? "";
}

describeDb("balayage systématique — 22 gestes × 22 étapes", () => {
  beforeAll(() => {
    prisma = createPrismaClient();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  for (const recette of RECETTES) {
    it(`étape « ${recette.cle} » encaisse les 22 gestes`, async () => {
      const scene = await creerScene(prisma, ids, { articles: 2 });
      const waId = recette.qui === "vendeuse" ? scene.vendeuseWaId : scene.acheteuseWaId;
      const phone = `+${waId}`;
      /* Le pilote ne compte PAS : le balayage note lui-meme, parce que le
         « double envoi » se joue en deux temps et que sa case appartient a
         l'etape du PREMIER, pas a celle ou la relivraison retombe. */
      const p = pilote(scene, waId);

      for (const geste of gestesDeLEtape(recette, scene)) {
        /**
         * Le monde ENTIER revient a neuf avant chaque geste.
         *
         * Remettre la seule colonne `etat` ne suffisait pas : le formulaire
         * d'inscription CREE une boutique, et les gestes suivants recevaient
         * « Une boutique existe déjà sur ce numéro » — une reponse produite par
         * le harnais lui-meme. Le premier balayage l'a montre, et c'est
         * exactement le faux constat qu'un audit doit s'interdire de rapporter.
         *
         * L'horloge revient aussi : sans cela, le geste qui suit « reprise après
         * 25 h » trouverait un etat instantanement perime.
         */
        await reinitialiserScene(scene, { articles: 2 });
        const etat = recette.etat(scene);
        if (etat === null) {
          await prisma.botConversation.deleteMany({ where: { phone } });
        } else {
          await poserEtape(scene, waId, etat);
        }

        let tour: Tour;
        if (geste.famille === "double_envoi") {
          /* Une relivraison n'existe qu'apres une livraison. On joue d'abord le
             message juste — non compte —, puis la MEME livraison. Ce que la
             case mesure est bien l'idempotence a cette etape (ADR 0040). */
          await p.jouer({
            famille: "texte_juste",
            intention: "avancer",
            livraison: (de, id) => ({
              entry: [
                {
                  changes: [
                    {
                      value: {
                        messages: [{ from: de, id, type: "text", text: { body: recette.juste } }],
                      },
                    },
                  ],
                },
              ],
            }),
            libelle: "amorce du double envoi",
          });
          tour = await p.jouer(geste);
        } else {
          tour = await p.jouer(geste);
        }

        compte.noter(recette.cle, geste.famille);
        jouees.push({
          etape: recette.cle,
          famille: geste.famille,
          libelle: geste.libelle,
          muet: tour.muet,
          etapeApres: tour.etapeApres,
          premiereReponse: resume(tour, scene),
        });
      }

      /* Aucune levee : `traiterLivraisonBot` avale ses exceptions et repond
         « panne passagère ». Ce message-la EST un echec, et il doit se voir. */
      const pannes = jouees.filter(
        (c) => c.etape === recette.cle && c.premiereReponse.includes("réessayez"),
      );
      expect(
        pannes.map((c) => c.libelle),
        "des gestes ont produit une panne",
      ).toEqual([]);
    });
  }

  it("rend le tableau de couverture, et le pose sur le disque", () => {
    const r = compte.rapport();

    const muets = jouees.filter((c) => c.muet && c.famille !== "silence");
    const lignesMuettes = muets
      .map((c) => `| ${c.etape} | ${c.famille} | ${c.libelle} | ${c.etapeApres} |`)
      .join("\n");

    /**
     * Les trois instantanes sont COMPOSES ici, et POSES par `poser.ts` — qui
     * refuse d'ecrire depuis une mesure incomplete (defaut du 14/08 : une
     * execution degradee ecrasait 534 lignes de mesure par un tableau a 0 %).
     *
     * Les deux assertions qui suivent disent CE QUI a manque ; le refus de
     * `poserInstantanes` tient l'invariant meme si ces lignes bougent un jour.
     */
    poserInstantanes(SORTIE, r, [
      {
        nom: "balayage-couverture.md",
        contenu: [
          "# Couverture mesurée par le harnais",
          "",
          "Produit par `harnais-balayage.test.ts`. **Ce fichier ne s'écrit pas à la main.**",
          "",
          "Une case non exercée est `non mesuré`, jamais `guidé`.",
          "",
          tableauMarkdown(r),
          "",
          `Seuil du §7 : ${SEUIL_PRINCIPAL} % sur les étapes principales.`,
          r.sousLeSeuil.length === 0
            ? "Aucune étape principale sous le seuil."
            : `**${r.sousLeSeuil.length} étape(s) principale(s) sous le seuil : ${r.sousLeSeuil.map((l) => l.etape).join(", ")}**`,
          "",
        ].join("\n"),
      },
      {
        nom: "balayage-muets.md",
        contenu: [
          "# Cases où la personne n'a RIEN reçu",
          "",
          "Produit par `harnais-balayage.test.ts`. **Ce fichier ne s'écrit pas à la main.**",
          "",
          "`silence` est exclu : aucun message n'est parti, donc aucune réponse n'est due.",
          "La question qu'il pose — une relance existe-t-elle ? — est ailleurs.",
          "",
          muets.length === 0
            ? "Aucune. Chaque geste a reçu une réponse."
            : ["| Étape | Geste | Détail | Étape après |", "|---|---|---|---|", lignesMuettes].join(
                "\n",
              ),
          "",
        ].join("\n"),
      },
      {
        nom: "balayage-reponses.md",
        contenu: [
          "# Ce que chaque geste a reçu, case par case",
          "",
          "Produit par `harnais-balayage.test.ts`. **Ce fichier ne s'écrit pas à la main.**",
          "",
          "| Étape | Geste | Étape après | Première réponse |",
          "|---|---|---|---|",
          ...jouees.map(
            (c) =>
              `| ${c.etape} | ${c.famille} | ${c.etapeApres} | ${c.muet ? "**— MUET —**" : c.premiereReponse.replace(/\|/g, "\\|")} |`,
          ),
          "",
        ].join("\n"),
      },
    ]);

    /* Une etape jouee qui n'est pas au catalogue veut dire que la machine a
       produit un etat que `couverture.ts` ne connait pas — donc que le tableau
       a un trou invisible. C'est un echec du HARNAIS, pas du produit. */
    expect(r.etapesInconnues, "des étapes jouées ne sont pas au catalogue").toEqual([]);

    /* Le harnais doit avoir joue TOUTES les cases de son propre catalogue :
       s'il en manque, c'est le balayage qui est incomplet, et le pourcentage
       ne mesure alors plus ce qu'il pretend. */
    expect(r.pourcentageGlobal, "le balayage n'a pas couvert son propre catalogue").toBe(100);
  });
});
