import { CODE_ALPHABET } from "@catalog/contracts";

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
 * Quatre recouvrements ont ete corriges, dans cet ordre :
 *
 * 1. **entre FICHIERS joues en parallele** (10/08) — un bloc par fichier ;
 * 2. **entre EXECUTIONS sur la meme base** (11/08) — celui-ci. La CI enchaine
 *    `pnpm test` PUIS `pnpm test:coverage` sur la MEME base postgres. Le sel
 *    d'execution occupait toute la tranche du fichier, si bien que les
 *    decalages par test (`RUN + 1`, `RUN + 2`, …) et les pas arithmetiques
 *    (`RUN + compteur * 7`) debordaient sur la tranche de l'execution
 *    precedente. Mesure : ~3 % de recouvrement pour des decalages de 1 a 16,
 *    ~7 % pour un pas de 7. Reproduit trois fois le 11/08.
 * 3. **le sel lui-meme, tire de l'horloge** (12/08) — celui-ci. Les deux
 *    correctifs precedents retirent l'AMPLIFICATION du recouvrement ; aucun ne
 *    retire le recouvrement. Deux executions partageant la meme milliseconde
 *    modulo 1000 restaient entierement confondues, et la CI en fabrique une
 *    paire a chaque passage. Le sel se POSE desormais — voir `selExecution()`.
 * 4. **les variantes taillees dans les chiffres du sel** (12/08, run
 *    31630675339) — un fichier non migre fabriquait des identifiants voisins
 *    en ecrasant les deux derniers chiffres du sien (`TX.slice(0, -2)+"91"`).
 *    Ces chiffres portent le SEL : quand celui de `pnpm test` finissait en 90,
 *    la variante etait l'identifiant de BASE de `pnpm test:coverage`, que la
 *    CI rend voisin par construction. Un passage sur dix, et DETERMINISTE au
 *    reessai — le `run_id` ne change pas. Les variantes sortent du schema
 *    desormais : le compteur a ses propres chiffres, il est fait pour ca.
 *
 * ── La contrainte qui commande la forme ───────────────────────────────────
 *
 * Le numero camerounais a NEUF chiffres apres l'indicatif, dont deux sont le
 * prefixe operateur : il reste **sept chiffres**. Tout doit y tenir.
 *
 *     bloc(2)  sel(3)  compteur(2)      →  BB SSS CC
 *      00-99   000-999    01-99
 *
 * Deux executions ne se recouvrent donc que si elles partagent le MEME sel. Ce
 * sel etait tire de l'horloge — une chance sur mille, et la CI en tire deux par
 * passage ; il se POSE maintenant, et la chance n'entre plus. Le compteur, lui,
 * ne peut pas deborder en silence : au-dela de 99, on leve.
 *
 * ── Cohabitation avec l'ancien schema ─────────────────────────────────────
 *
 * Les fichiers non migres produisent `bloc(3) * 1000 + sel(3)`, donc au plus SIX
 * chiffres : leur queue de sept chiffres commence toujours par un zero. Les
 * blocs d'ici sont **>= 10**, donc sept chiffres significatifs. Les deux
 * familles ne peuvent pas se croiser, et `_identifiants.test.ts` le tient.
 *
 * Ces fichiers-la gardent leur propre bloc a trois chiffres, mais ils ne tirent
 * plus leur sel : ils appellent `selExecution()`. C'est le minimum qui ferme le
 * defaut, et c'est deliberement moins qu'une migration complete — reecrire
 * quatorze fichiers de fixtures pour gagner une forme n'aurait rien ferme de
 * plus, et chaque reecriture est une occasion de casser un test qui passait.
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
  "bot-comptoir": 13,
  "gabarits-jamais-appeles": 14,
  "bot-flux-article": 15,
  /* Les sept ci-dessous gardent telephones et adresses sur l'ancien sel — les
     deux familles sont disjointes par construction, voir l'en-tete. Ils
     prennent au schema `codeVerification()` (tache #68), et `preuve-route`
     y prend AUSSI ses identifiants MTN depuis le recouvrement n° 4. */
  "bot-apres-achat": 16,
  "bot-conges": 17,
  "commandes-route": 18,
  "preuve-route": 19,
  "relances-par-la-porte": 20,
  "stats-route": 21,
  "traces-sans-sms": 22,
  "bot-preuve-fil": 23,
  "expiration-commande": 24,
  "bot-rafale": 25,
  "bot-carte-entretenue": 26,
  "bot-reversement": 27,
  "bot-etapes": 28,
  "bot-suivi": 29,
  "bot-resume": 30,
  "bot-ouverture-photo": 31,
  "bot-photos-acheteuse": 32,
  "bot-photos-vendeuse": 33,
  "bot-catalogue": 34,
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
   * Un code de verification `XXXX-XXXX`, sur l'alphabet non ambigu du lot 3.
   *
   * ── Pourquoi il vit ICI et pas dans chaque fichier ────────────────────────
   *
   * Les fichiers se recopiaient un `codeDeTest(graine)` qui HACHE sa graine
   * (`n * 31 + 17` modulo 1 000 003). Le bloc partitionne les NOMBRES ; il ne
   * partitionne pas ce qu'un hachage en fait. Pire, les nombres d'ici
   * depassent le module, donc ils retombent dans la plage des autres fichiers :
   * deux graines separees par construction produisaient le meme code.
   *
   * `verification_code` est UNIQUE et la base n'est jamais purgee. Mesure du
   * 12/08 : vert en local, rouge en CI sur `RYEC-6XVX`.
   *
   * Ici l'encodage est INJECTIF — un changement de base, pas un hachage : deux
   * appels differents ne peuvent pas rendre le meme code, et ca se demontre au
   * lieu de s'esperer. 25^8 vaut 1,5 x 10^11, la place ne manque pas.
   */
  codeVerification(): string;
  /**
   * Identifiant Orange. Le gabarit `MP260623.1403.Cnnnnn` ne laisse que CINQ
   * chiffres : le bloc n'y tient pas. C'est acceptable parce qu'un seul fichier
   * fabrique des identifiants Orange — `_identifiants.test.ts` le verifie, et
   * echouera le jour ou un second s'y mettra.
   */
  txOrange(): string;
}

/**
 * Le nom de la variable qui POSE le sel d'une execution.
 *
 * ── Pourquoi elle existe ──────────────────────────────────────────────────
 *
 * Le bloc separe les FICHIERS. Il ne separe pas les EXECUTIONS : celles-ci le
 * sont par le sel, et un sel tire de l'horloge les separe **par chance**, une
 * fois sur mille. La CI enchaine `pnpm test` PUIS `pnpm test:coverage` sur LE
 * MEME conteneur postgres — une paire d'executions, garantie a chaque passage.
 * Une fois sur mille par paire, ce n'est pas rare, c'est intermittent : c'est
 * exactement la forme d'echec qu'on met des semaines a diagnostiquer, parce
 * qu'il est vert au reessai.
 *
 * Quand la variable est posee, deux executions sont disjointes **par
 * construction**. C'est la seule difference qui compte entre ce schema et le
 * precedent — a condition que la valeur posee varie d'un passage a l'autre,
 * voir `selExecution()`.
 */
export const VARIABLE_SEL = "CATALOG_SEL_EXECUTION";

/**
 * Le sel de CETTE execution : pose par l'environnement, sinon tire de
 * l'horloge.
 *
 * ── La propriete qu'on cherche, dite une fois ─────────────────────────────
 *
 * > Deux executions **contre la meme base** ne doivent jamais partager un sel.
 *
 * Tout le reste en decoule, et notamment ceci : **une CONSTANTE ne convient
 * pas**. Poser `1` et `2` separe bien les deux etapes d'un passage, mais si la
 * base survit au passage — un poste de developpement, une preproduction — le
 * passage suivant repose `1` et recouvre le precedent EN ENTIER. Mesure du
 * 12/08 : quatorze fichiers rouges d'un coup, tous sur `email`. On aurait
 * echange un recouvrement rare contre un recouvrement certain.
 *
 * D'ou la forme retenue : la CI pose une valeur DERIVEE DU PASSAGE
 * (`github.run_id`, suffixe par etape). Deux etapes du meme passage different ;
 * deux passages different aussi. La valeur peut donc etre grande — elle est
 * ramenee modulo mille ici, ou les trois chiffres du sel vivent.
 *
 * ── Pourquoi la valeur vide est un refus, et non un repli ─────────────────
 *
 * `Number("")` vaut **zero**, pas NaN. C'est la meme arete que celle qui a
 * produit un paiement de zero franc parfaitement forme au lot 8 (ADR 0019) :
 * une variable posee mais vide donnerait le sel 0 en silence, donc deux
 * executions identiques — precisement le defaut qu'on ferme ici. Le controle
 * porte donc sur la CHAINE, avant toute conversion.
 *
 * Un repli silencieux serait pire que le defaut : la CI redeviendrait
 * intermittente sans que rien ne le dise. Une variable mal posee doit rougir.
 */
export function selExecution(): number {
  const brut = process.env[VARIABLE_SEL];
  /* Absente : developpement local, base jetable, le tirage suffit. */
  if (brut === undefined) return Date.now() % 1000;

  const net = brut.trim();
  /* `\d+` et non `\d{1,3}` : la CI pose un identifiant de passage, qui est long.
     La borne n'est pas sur ce qu'on accepte, elle est sur ce qu'on en garde. */
  if (net === "" || !/^\d+$/.test(net) || !Number.isSafeInteger(Number(net))) {
    throw new Error(
      `${VARIABLE_SEL} vaut ${JSON.stringify(brut)} : on attend un entier positif. ` +
        'Une valeur vide donnerait le sel 0 en silence — `Number("")` vaut zero — ' +
        "et deux executions de sel 0 se recouvrent entierement. Retirer la " +
        "variable rend le tirage a l'horloge ; la poser mal ne doit rien rendre.",
    );
  }
  return Number(net) % 1000;
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
  const sel = selImpose ?? selExecution();
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
    codeVerification: () => {
      let n = suivant();
      const car: string[] = [];
      for (let i = 0; i < 8; i++) {
        car.push(CODE_ALPHABET[n % CODE_ALPHABET.length] as string);
        n = Math.floor(n / CODE_ALPHABET.length);
      }
      return `${car.slice(0, 4).join("")}-${car.slice(4).join("")}`;
    },
    txOrange: () => {
      /* Passe par `suivant()` — donc par le garde des 99 — puis n'en garde que
         le sel et le compteur, les cinq chiffres que le gabarit autorise. */
      const compteurDeCeltui = suivant() % 100;
      return `MP260623.1403.C${String(sel * 100 + compteurDeCeltui).padStart(5, "0")}`;
    },
  };
}
