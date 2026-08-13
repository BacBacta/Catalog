import type { PrismaClient } from "@catalog/db";
import type { MagasinDefis } from "./auth-connexion-whatsapp.ts";
import { cleConversation } from "./bot.ts";
import { issueConnexion, messageConnexion } from "./domain/bot/connexion-fil.ts";
import type { EnvoyeurBot } from "./domain/bot/envoyeur.ts";
import { normaliserLangue } from "./domain/bot/textes.ts";
import { extraireCodeDefi } from "./domain/connexion-whatsapp.ts";

/**
 * L'accuse de connexion DANS LE FIL — le service, autour du domaine pur de
 * `domain/bot/connexion-fil.ts`.
 *
 * Il ne s'interpose pas dans la connexion : elle est deja jouee quand on
 * arrive ici. Il RACONTE ce qui vient de se passer, la ou la personne a
 * envoye son message. De CONFORT au sens strict — un envoi qui echoue ne
 * defait aucune session, et c'est pour cela que l'appelant l'ignore.
 */

/**
 * La marque « ce code a deja recu sa reponse ». Elle vit dans le meme magasin
 * que les defis : rien de nouveau a migrer, et elle meurt toute seule.
 */
const CLE_ACCUSE = (code: string) => `conn-wa-accuse:${code}`;

/**
 * Trente minutes, la ou un defi en vit cinq. Ce n'est pas la duree du code,
 * c'est celle des RELIVRAISONS de Meta : la marque doit survivre au message
 * qu'elle desamorce, pas au defi.
 */
const DUREE_MARQUE_MS = 30 * 60_000;

export interface ConnexionFilDeps {
  magasin: MagasinDefis;
  envoyeur: EnvoyeurBot;
  prisma: PrismaClient;
  maintenant?: () => Date;
}

export async function accuserConnexionDansLeFil(
  deps: ConnexionFilDeps,
  message: { de: string; texte: string },
  verdict: "verifie" | "ignore",
): Promise<void> {
  const code = extraireCodeDefi(message.texte);
  if (!code) return; // une conversation ordinaire : c'est le bot qui repond

  const dejaAccuse = Boolean(await deps.magasin.findVerificationValue(CLE_ACCUSE(code)));
  const issue = issueConnexion({ porteUnCode: true, verdict, dejaAccuse });
  if (issue === "silence") return;

  /* La langue du fil, quand ce fil existe deja. Une premiere connexion n'a
     pas encore de conversation : le francais est le defaut, comme partout. */
  const phone = cleConversation(message.de);
  const enregistrement = phone
    ? await deps.prisma.botConversation
        .findUnique({ where: { phone }, select: { langue: true } })
        .catch(() => null)
    : null;

  await deps.envoyeur.envoyer(
    messageConnexion(message.de, issue, normaliserLangue(enregistrement?.langue)),
  );

  /* La marque APRES l'envoi : si l'envoi echoue, la relivraison de Meta est
     une seconde chance, pas un silence de plus. */
  const maintenant = deps.maintenant?.() ?? new Date();
  await deps.magasin.createVerificationValue({
    identifier: CLE_ACCUSE(code),
    value: issue,
    expiresAt: new Date(maintenant.getTime() + DUREE_MARQUE_MS),
  });
}
