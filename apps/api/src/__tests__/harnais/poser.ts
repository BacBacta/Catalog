import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mesureComplete, type Rapport } from "./couverture.ts";

/**
 * L'ECRITURE des instantanes du balayage — et son refus.
 *
 * ── Le defaut du 14/08 ────────────────────────────────────────────────────
 *
 * `balayage-*.md` sont des artefacts PRODUITS, et ils sont VERSIONNES : c'est
 * ce qui rend une regression de couverture visible dans un diff. Les trois
 * `writeFileSync` du balayage etaient inconditionnels, et poses AVANT
 * l'assertion de completude. Consequence, mesuree :
 *
 *     DATABASE_URL pose mais inutilisable  →  les 22 etapes echouent
 *                                          →  `jouees` reste vide
 *                                          →  les trois fichiers sont ecrits
 *                                             a 0 %, puis le test echoue
 *
 * `balayage-reponses.md` est passe de 534 lignes a 6, et le tableau de
 * couverture a affiche `0 %` sur les vingt-quatre etapes. Le test echouait
 * bien — mais APRES, et un `git commit -a` par-dessus aurait remplace la mesure
 * de l'audit par sa negation, sans que personne ne l'ait decide.
 *
 * Le cas se produit chaque fois qu'une execution est degradee sans etre
 * sautee : identifiants en collision (meme sel rejoue), base migree a moitie,
 * une etape qui leve. Il ne se produit PAS quand la base est absente — la, tout
 * le `describe` est saute et rien ne s'ecrit.
 *
 * ── La regle ──────────────────────────────────────────────────────────────
 *
 * Un instantane ne s'ecrit QUE depuis une mesure complete. Une execution
 * partielle ne laisse rien derriere elle : le fichier du dernier balayage
 * complet reste en place, et c'est la bonne valeur par defaut — un artefact
 * perime se date et se rejoue, un artefact ecrase ne se retrouve pas.
 *
 * La regle est tenue ICI, dans l'ecrivain, et non par l'ordre des lignes du
 * test : l'ordre se defait a la premiere reorganisation, et personne ne verra
 * qu'il portait un invariant.
 *
 * Les transcriptions `.txt` des parcours n'ont pas ce probleme : elles passent
 * par `toMatchFileSnapshot`, qui compare et ECHOUE au lieu d'ecraser.
 */

export interface Instantane {
  /** Le nom du fichier, dans `harnais/instantanes/`. */
  nom: string;
  contenu: string;
}

/**
 * Ecrit les instantanes, ou n'en ecrit AUCUN.
 *
 * Tout ou rien, deliberement : trois fichiers qui se lisent ensemble ne doivent
 * pas pouvoir dater de deux balayages differents.
 *
 * Leve quand la mesure est incomplete. Le message dit ce qui manque et ce qui
 * n'a PAS ete ecrit — sans quoi le lecteur croirait avoir devant lui l'etat du
 * disque.
 */
export function poserInstantanes(sortie: string, r: Rapport, fichiers: Instantane[]): void {
  if (!mesureComplete(r)) {
    const manque =
      r.etapesInconnues.length > 0
        ? `étapes hors catalogue : ${r.etapesInconnues.join(", ")}`
        : `couverture ${r.pourcentageGlobal} % au lieu de 100 % (${r.totalExercees}/${r.totalPossibles} cases)`;
    throw new Error(
      `Balayage incomplet — ${manque}. Aucun instantané n'a été écrit : ` +
        `${fichiers.map((f) => f.nom).join(", ")} gardent la mesure du dernier ` +
        "balayage complet. Une mesure partielle n'écrase pas une mesure entière.",
    );
  }
  for (const f of fichiers) writeFileSync(join(sortie, f.nom), f.contenu, "utf8");
}
