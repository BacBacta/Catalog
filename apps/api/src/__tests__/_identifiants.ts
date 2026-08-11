/**
 * Les identifiants des tests qui touchent la base.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 *
 * Les tests d'integration ecrivent dans une vraie base, et le schema porte de
 * vraies contraintes d'unicite : `email`, `phone_number`, et surtout
 * `(operator, operator_tx_id)` — le controle n° 5, celui qui vaut sur TOUT le
 * reseau. Deux tests qui fabriquent le meme identifiant ne se genent pas
 * poliment : l'un des deux echoue, et son echec ressemble a un defaut metier.
 *
 * Deux recouvrements ont ete corriges, dans cet ordre :
 *
 * 1. **entre FICHIERS joues en parallele** (10/08) — un bloc par fichier ;
 * 2. **entre EXECUTIONS sur la meme base** (11/08) — celui-ci. La CI enchaine
 *    `pnpm test` PUIS `pnpm test:coverage` sur la MEME base postgres. Le sel
 *    d'execution occupait toute la tranche du fichier, si bien que les
 *    decalages par test (`RUN + 1`, `RUN + 2`, …) et les pas arithmetiques
 *    (`RUN + compteur * 7`) debordaient sur la tranche de l'execution
 *    precedente. Mesure : ~3 % de recouvrement pour des decalages de 1 a 16,
 *    ~7 % pour un pas de 7. Reproduit trois fois le 11/08.
 *
 * ── La contrainte qui commande la forme ───────────────────────────────────
 *
 * Le numero camerounais a NEUF chiffres apres l'indicatif, dont deux sont le
 * prefixe operateur : il reste **sept chiffres**. Tout doit y tenir.
 *
 *     bloc(2)  sel(3)  compteur(2)      →  BB SSS CC
 *      00-99   000-999    01-99
 *
 * Deux executions ne se recouvrent donc que si elles partagent la MEME
 * milliseconde modulo 1000 — une chance sur mille, sans amplification par un
 * pas. Et le compteur ne peut plus deborder en silence : au-dela de 99, on
 * leve.
 *
 * ── Cohabitation avec l'ancien schema ─────────────────────────────────────
 *
 * Les fichiers non encore migres produisent `bloc(3) * 1000 + sel(3)`, donc au
 * plus SIX chiffres : leur queue de sept chiffres commence toujours par un
 * zero. Les blocs d'ici sont **>= 10**, donc sept chiffres significatifs. Les
 * deux familles ne peuvent pas se croiser, et `_identifiants.test.ts` le tient.
 */

/**
 * Un bloc par fichier, ecrits a la main et non derives d'une empreinte.
 *
 * Quatorze fichiers dans cent cases : une empreinte les ferait entrer en
 * collision une fois sur deux (paradoxe des anniversaires). La table est donc
 * explicite, et un test verifie qu'aucune valeur ne se repete — c'est le genre
 * de faute qui ne se voit pas a la lecture.
 */
export const BLOCS = {
  "attaques-preuve": 11,
  "recu-route": 12,
} as const;

export type Fichier = keyof typeof BLOCS;

export interface Identifiants {
  /** Le nombre a sept chiffres, unique par fichier, execution et appel. */
  suivant(): number;
  /** `+237` + prefixe operateur (2 chiffres) + les sept chiffres. */
  tel(prefixe: string): string;
  /** Une adresse qui ne peut appartenir a personne — `.invalid` est reserve. */
  email(quoi: string): string;
  /** Identifiant MTN : `176` puis huit chiffres. */
  txMtn(): string;
  /**
   * Identifiant Orange. Le gabarit `MP260623.1403.Cnnnnn` ne laisse que CINQ
   * chiffres : le bloc n'y tient pas. C'est acceptable parce qu'un seul fichier
   * fabrique des identifiants Orange — `_identifiants.test.ts` le verifie, et
   * echouera le jour ou un second s'y mettra.
   */
  txOrange(): string;
}

/**
 * @param selImpose reserve aux tests de ce schema. La propriete qui compte —
 * deux executions de sels DIFFERENTS ne se croisent jamais — ne se demontre
 * qu'en choisissant les sels ; sans ce parametre elle resterait une croyance
 * verifiee par tirage au sort.
 */
export function identifiants(fichier: Fichier, selImpose?: number): Identifiants {
  const bloc = BLOCS[fichier];
  /* Le sel n'est lu QU'UNE FOIS, a la construction : deux appels espaces de
     quelques millisecondes ne doivent pas changer de tranche. */
  const sel = selImpose ?? Date.now() % 1000;
  let compteur = 0;

  const suivant = (): number => {
    compteur += 1;
    if (compteur > 99) {
      throw new Error(
        `${fichier} : plus de 99 identifiants dans une execution. ` +
          "La disposition bloc(2)·sel(3)·compteur(2) tient dans les sept " +
          "chiffres d'un numero camerounais ; l'elargir demande de revoir " +
          "les deux, pas d'agrandir le compteur.",
      );
    }
    return bloc * 100_000 + sel * 100 + compteur;
  };

  return {
    suivant,
    tel: (prefixe) => `+237${prefixe}${String(suivant()).padStart(7, "0")}`,
    email: (quoi) => `${quoi}-${suivant()}@telephone.catalog.invalid`,
    txMtn: () => `176${String(suivant()).padStart(8, "0")}`,
    txOrange: () => {
      /* Passe par `suivant()` — donc par le garde des 99 — puis n'en garde que
         le sel et le compteur, les cinq chiffres que le gabarit autorise. */
      const compteurDeCeltui = suivant() % 100;
      return `MP260623.1403.C${String(sel * 100 + compteurDeCeltui).padStart(5, "0")}`;
    },
  };
}
