/**
 * Sonde de la connexion par WhatsApp — lecture seule.
 *
 *   node apps/api/scripts/diagnostic-connexion.mjs
 *
 * Elle repond a UNE question, celle qui a coute une matinee le 13/08 : quand
 * une connexion echoue, ou la chaine s'arrete-t-elle ? Le defi est-il cree
 * (l'app a parle a l'API), consomme (la route entrante a applique le message), ou
 * verifie sans que l'app ne le voie (le probleme est cote navigateur) ?
 *
 * Elle n'imprime AUCUN secret : les identifiants de defi sont masques a
 * quatre caracteres, les valeurs ne montrent que leur STATUT. Les codes
 * meurent en cinq minutes de toute facon — mais la discipline ne se negocie
 * pas a la duree de vie.
 */
import { createPrismaClient } from "@catalog/db";

const URL = process.env.DATABASE_URL;
if (!URL) {
  console.error("DATABASE_URL absente — la sonde lit une vraie base, ou rien.");
  process.exit(1);
}

const banc = (process.env.BANC_ESSAI_NUMEROS_HORS_CM ?? "").trim();
console.log(
  `BANC_ESSAI_NUMEROS_HORS_CM : ${banc ? `posee (${banc.split(",").length} entree(s))` : "ABSENTE"}`,
);

const prisma = createPrismaClient(URL);
const lignes = await prisma.$queryRawUnsafe(`
  SELECT identifier, value, expires_at, created_at
  FROM verification
  WHERE identifier LIKE 'conn-wa-%'
  ORDER BY created_at DESC
  LIMIT 15
`);

if (lignes.length === 0) {
  console.log(
    "\nAucune ligne 'conn-wa-*' dans la table verification. Soit aucun defi " +
      "recent, soit les identifiants sont stockes HACHES (option Better Auth) " +
      "— dans ce cas la sonde compte sans filtrer :",
  );
  const total = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM verification WHERE created_at > now() - interval '30 minutes'`,
  );
  console.log(`  lignes de verification des 30 dernieres minutes : ${total[0]?.n ?? "?"}`);
} else {
  console.log(`\n${lignes.length} defi(s) recents (les plus neufs d'abord) :\n`);
  for (const l of lignes) {
    const [, genre, suffixe] = /^conn-wa-(\w+):(.*)$/.exec(l.identifier) ?? [];
    let statut = "porteur (code non consomme)";
    try {
      const v = JSON.parse(l.value);
      if (v.statut) statut = v.statut === "verifie" ? "VERIFIE" : "en_attente";
    } catch {
      statut = "illisible";
    }
    console.log(
      `  ${String(genre).padEnd(6)} ${String(suffixe).slice(0, 4)}…` +
        ` · ${statut.padEnd(24)} · cree ${l.created_at.toISOString().slice(11, 19)}` +
        ` · expire ${l.expires_at.toISOString().slice(11, 19)}`,
    );
  }
  console.log(
    "\nLecture : un CODE encore present = la route entrante n'a rien applique ;" +
      "\nun defi/suivi VERIFIE = le serveur a fini, le probleme est cote app.",
  );
}

await prisma.$disconnect();
