import { readFileSync } from "node:fs";
import {
  type ConfigurationCohorte,
  type PositionDInterrupteur,
  positionDepuis,
} from "./domain/deploiement/ouverture.ts";

/**
 * La configuration de deploiement, lue au bord.
 *
 * Le domaine ne lit ni fichier ni environnement (regle de dependance
 * d'AGENTS.md) : ce module est la couture entre `process.env`, le disque, et
 * les fonctions pures de `domain/deploiement/ouverture.ts`.
 *
 * ── Pourquoi un FICHIER en plus de la variable d'environnement ─────────────
 *
 * Une variable d'environnement ne change pas dans un processus vivant : la
 * modifier suppose un redemarrage, donc un deploiement, donc quelques minutes
 * et une chaine d'outils qui marche. Or l'interrupteur d'arret sert precisement
 * les jours ou l'on n'a ni les minutes ni la certitude que la chaine marche.
 *
 * Le fichier repond a ce cas : `echo lecture_seule > /run/catalog/interrupteur`
 * et le service bascule en deux secondes, sans redemarrage et sans deploiement.
 * La variable reste la valeur par defaut, celle qui survit au redemarrage — les
 * deux ne servent pas au meme moment.
 *
 * La lecture est mise en cache deux secondes : un appel systeme par requete HTTP
 * serait un cout qu'on paie tous les jours pour un mecanisme qui sert deux fois
 * par an.
 */

const CACHE_MS = 2_000;

let cache: { a: number; position: PositionDInterrupteur } | null = null;

/**
 * La position courante de l'interrupteur.
 *
 * Le fichier gagne sur la variable quand il existe et porte une valeur connue.
 * Un fichier absent, illisible ou vide n'est **pas** une erreur : on retombe sur
 * la variable. Faire l'inverse — arreter le service parce qu'un fichier manque —
 * transformerait ce garde-fou en cause de panne.
 */
export function positionCourante(
  env: NodeJS.ProcessEnv = process.env,
  maintenant: () => number = () => Date.now(),
): PositionDInterrupteur {
  const t = maintenant();
  if (cache && t - cache.a < CACHE_MS) return cache.position;

  let position = positionDepuis(env.INTERRUPTEUR);
  const chemin = env.INTERRUPTEUR_FICHIER;
  if (chemin) {
    try {
      const contenu = readFileSync(chemin, "utf8").trim();
      if (contenu) position = positionDepuis(contenu);
    } catch {
      /* Fichier absent ou illisible : la variable fait foi. */
    }
  }

  cache = { a: t, position };
  return position;
}

/** Vide le cache. Reserve aux tests : en production, deux secondes suffisent. */
export function oublierPosition(): void {
  cache = null;
}

/**
 * La cohorte ouverte.
 *
 * `COHORTE_POURCENT` absent vaut **100** : le mecanisme est inerte tant que
 * personne ne l'arme. Un defaut a zero mettrait le produit hors service au
 * premier deploiement ou la variable manque, ce qui est exactement le genre de
 * panne qu'un mecanisme de securite ne doit pas provoquer.
 */
export function cohorteDepuisEnv(env: NodeJS.ProcessEnv = process.env): ConfigurationCohorte {
  const brut = Number(env.COHORTE_POURCENT);
  const pourcent = Number.isFinite(brut) ? brut : 100;
  const pilotes = (env.COHORTE_PILOTES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { pourcent, pilotes };
}

/** Les en-tetes de securite portent HSTS uniquement quand on sait etre en HTTPS. */
export function hstsActif(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HSTS === "true";
}
