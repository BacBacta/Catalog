import type { CanalUssd, OperateurRampe, RampeConfig } from "@catalog/contracts/ussd";

/**
 * **La configuration de la rampe — le SEUL fichier du depot ou un code USSD est
 * ecrit.**
 *
 * C'est une contrainte du lot 9, et elle vient du terrain : les codes d'entree
 * ont ete releves le 29/07/2026 dans la reponse de l'API de l'agregateur, qui
 * les renvoie par transaction. La lecon d'implementation etait ecrite le jour
 * meme dans `docs/terrain/rampe-paiement.html` : **le code doit venir de la
 * reponse de l'operateur, jamais d'une constante en dur.** Un code fige dans le
 * code source se remplace par un redeploiement — c'est-a-dire trop tard, le jour
 * ou un operateur le change.
 *
 * D'ou la forme retenue :
 *
 * - les valeurs ci-dessous sont un DEFAUT, date et source, pas une verite ;
 * - chacune se surcharge par une variable d'environnement, donc sans
 *   redeploiement ni reconstruction de la boutique — l'ilot de paiement lit
 *   `GET /api/rampe` a l'execution ;
 * - une valeur d'environnement mal formee est IGNOREE au profit du defaut, comme
 *   pour les plafonds de limitation de debit : une faute de frappe ne doit pas
 *   fabriquer une chaine qui ne compose rien.
 *
 * ── Le drapeau `verifie` ──────────────────────────────────────────────────
 *
 * `true` uniquement pour ce qui a ete constate. Les codes d'entree le sont. Les
 * raccourcis parametres — les chaines completes censees sauter les niveaux de
 * menu — ne le sont PAS : personne ne les a composes sur un telephone reel a
 * Douala. Ils restent proposes, avec le chemin manuel a cote, et l'interface le
 * dit. C'est la regle du produit : un format reconstitue se marque « a
 * confirmer » dans le code ET dans l'interface, il ne se promeut jamais
 * silencieusement.
 *
 * Module PUR : `rampeDepuisEnv` recoit l'environnement en parametre, il ne le
 * lit pas.
 */

/**
 * Etapes ecrites en clair, affichees SOUS le bouton de rampe, toujours.
 *
 * Les intitules de menu exacts n'ont pas ete releves sur un telephone : ils sont
 * formules par leur FONCTION — « l'option de transfert d'argent » — et non par
 * un libelle invente qui se lirait comme une consigne. `etapesAConfirmer` porte
 * cette reserve jusque dans l'interface.
 */
const ETAPES: string[] = [
  "Touchez « Composer » : le clavier de votre telephone s'ouvre.",
  "Appuyez sur appeler. La session de votre operateur prend le relais.",
  "Choisissez l'option de transfert d'argent vers un abonne.",
  "Saisissez le numero de la vendeuse, puis le montant exact.",
  "Confirmez avec votre code secret — il se tape chez l'operateur, jamais ici.",
];

/**
 * Comment controler une transaction deja passee, aupres de l'operateur.
 *
 * Le recu du lot 10 les affiche. Le code a composer n'est PAS ecrit ici : c'est
 * `codeEntree`, celui qui est verifie, et le recu le lit dans cette meme
 * configuration. Un recu qui figerait un code enverrait l'acheteuse sur un code
 * faux le jour ou l'operateur en change — c'est l'interdit « figer un code USSD
 * en constante » d'AGENTS.md, sous une autre forme.
 *
 * Comme `ETAPES`, ces intitules nomment les options par leur FONCTION : ils
 * n'ont pas ete releves sur un telephone, et `etapesAConfirmer` porte la
 * reserve jusque dans l'interface.
 */
const ETAPES_VERIFICATION: string[] = [
  "Composez le code de votre operateur ci-dessus.",
  "Demandez l'historique ou le releve de vos transactions.",
  "Retrouvez la ligne portant cet identifiant, ce montant et cette date.",
  "En cas de doute, presentez l'identifiant en agence : l'operateur seul fait foi.",
];

export const RAMPE_DEFAUT: RampeConfig = {
  version: 1,
  operateurs: [
    {
      id: "mtn",
      nom: "MTN Mobile Money",
      codeEntree: {
        id: "mtn-entree",
        libelle: "Ouvrir le menu MoMo",
        // Releve le 29/07/2026 dans la reponse de l'API de l'agregateur.
        modele: "*126#",
        verifie: true,
      },
      raccourcis: [
        {
          id: "mtn-raccourci",
          libelle: "Raccourci : transfert vers un abonne MoMo",
          modele: "*126*1*1*{numero}*{montant}#",
          // NON VERIFIE : hypothese de niveaux de menu, jamais composee a Douala.
          verifie: false,
        },
      ],
      etapes: ETAPES,
      etapesVerification: ETAPES_VERIFICATION,
      etapesAConfirmer: true,
      // Mesure le 29/07/2026 : MTN accepte 5 F.
      montantMinXaf: 5,
    },
    {
      id: "orange",
      nom: "Orange Money",
      codeEntree: {
        id: "orange-entree",
        libelle: "Ouvrir le menu Orange Money",
        // Releve le 29/07/2026. Ce n'est PAS `#150#` : la supposition de depart
        // etait fausse, et c'est la reponse de l'operateur qui a tranche.
        modele: "#150*50#",
        verifie: true,
      },
      raccourcis: [
        {
          id: "orange-raccourci",
          libelle: "Raccourci : transfert vers un abonne Orange Money",
          modele: "#150*50*{numero}*{montant}#",
          verifie: false,
        },
      ],
      etapes: ETAPES,
      etapesVerification: ETAPES_VERIFICATION,
      etapesAConfirmer: true,
      // Mesure le 29/07/2026 : Orange refuse sous 10 F (erreur ER201).
      montantMinXaf: 10,
    },
  ],
};

/* ──────────────────────── surcharge par l'environnement ─────────────────── */

export interface EnvLike {
  [cle: string]: string | undefined;
}

/**
 * Un gabarit est valide s'il ne produit qu'une chaine composable.
 *
 * On le verifie en le remplissant d'un echantillon : ce qui reste doit n'etre
 * que chiffres, etoiles et dieses. Une virgule ou une espace glissee par une
 * variable d'environnement ferait passer autre chose qu'un appel dans un lien
 * `tel:`.
 */
export function modeleValide(modele: string): boolean {
  const rempli = modele.split("{numero}").join("677123456").split("{montant}").join("100");
  return /^[*#0-9]+$/.test(rempli) && /[*#]/.test(rempli);
}

function texte(env: EnvLike, cle: string): string | null {
  const v = env[cle]?.trim();
  return v ? v : null;
}

function entier(env: EnvLike, cle: string): number | null {
  const v = texte(env, cle);
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** `"true"` et rien d'autre. Un drapeau de verification ne se devine pas. */
function drapeau(env: EnvLike, cle: string): boolean | null {
  const v = texte(env, cle)?.toLowerCase();
  if (v === undefined || v === null) return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function surchargerCanal(canal: CanalUssd, env: EnvLike, prefixe: string): CanalUssd {
  const modele = texte(env, `${prefixe}_MODELE`);
  const verifie = drapeau(env, `${prefixe}_VERIFIE`);
  return {
    ...canal,
    modele: modele !== null && modeleValide(modele) ? modele : canal.modele,
    /**
     * Le drapeau ne suit PAS le gabarit : une chaine changee par l'environnement
     * reste non verifiee tant que quelqu'un n'a pas pose `..._VERIFIE=true` apres
     * l'avoir composee. Poser le drapeau est un acte separe, et c'est voulu.
     */
    verifie: verifie !== null ? verifie : canal.verifie,
  };
}

/**
 * La configuration effective.
 *
 * Variables reconnues, par operateur (`MTN`, `ORANGE`) :
 *
 * - `RAMPE_<OP>_ENTREE_MODELE` / `_VERIFIE`
 * - `RAMPE_<OP>_RACCOURCI_MODELE` / `_VERIFIE`
 * - `RAMPE_<OP>_MIN_XAF`
 *
 * Toute valeur absente ou mal formee laisse le defaut en place.
 */
export function rampeDepuisEnv(env: EnvLike, base: RampeConfig = RAMPE_DEFAUT): RampeConfig {
  return {
    version: base.version,
    operateurs: base.operateurs.map((op) => surchargerOperateur(op, env)),
  };
}

function surchargerOperateur(op: OperateurRampe, env: EnvLike): OperateurRampe {
  const prefixe = `RAMPE_${op.id.toUpperCase()}`;
  return {
    ...op,
    codeEntree: surchargerCanal(op.codeEntree, env, `${prefixe}_ENTREE`),
    raccourcis: op.raccourcis.map((r, i) =>
      surchargerCanal(r, env, i === 0 ? `${prefixe}_RACCOURCI` : `${prefixe}_RACCOURCI_${i + 1}`),
    ),
    montantMinXaf: entier(env, `${prefixe}_MIN_XAF`) ?? op.montantMinXaf,
  };
}
