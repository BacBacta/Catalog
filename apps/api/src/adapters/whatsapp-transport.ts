/**
 * Le TRANSPORT des messages WhatsApp — ADR 0046.
 *
 * Le format des corps est celui de la Cloud API de Meta, quel que soit le
 * chemin emprunte : le domaine ne sait pas qui transporte, et c'est ce qui
 * rend ce fichier possible. Deux chemins existent, et ils different sur trois
 * points seulement.
 *
 * ┌──────────────────┬──────────────────────────────┬──────────────────────────┐
 * │                  │ 360dialog                    │ Meta directe             │
 * ├──────────────────┼──────────────────────────────┼──────────────────────────┤
 * │ Authentification │ `D360-API-KEY: <cle>`        │ `Authorization: Bearer`  │
 * │ Envoi            │ `{base}/messages`            │ `{base}/{idNumero}/mes…` │
 * │ Media, 2e temps  │ hote de l'URL REECRIT vers   │ URL suivie TELLE QUELLE  │
 * │                  │ celui de l'API               │                          │
 * └──────────────────┴──────────────────────────────┴──────────────────────────┘
 *
 * **La reecriture d'hote est le piege.** Elle est indispensable chez
 * 360dialog — leur documentation l'exige, et l'omettre a coute le diagnostic
 * du 02/08/2026. Appliquee a Meta, elle CASSE le telechargement : l'URL de
 * `lookaside.fbsbx.com` accepte le jeton porteur telle quelle.
 *
 * `docs/terrain/test-bot-sandbox.md` a longtemps affirme que passer au numero
 * de test Meta etait « un changement d'environnement, pas de code ». C'etait
 * faux sur ces deux points, et ce fichier est la reponse.
 */

export type TransportWhatsapp = "360dialog" | "meta";

/** Les hotes connus, et le transport qu'ils impliquent. */
const HOTES: ReadonlyArray<readonly [RegExp, TransportWhatsapp]> = [
  [/(^|\.)360dialog\.io$/i, "360dialog"],
  [/(^|\.)facebook\.com$/i, "meta"],
];

function depuisLaBase(baseUrl: string): TransportWhatsapp | null {
  let hote: string;
  try {
    hote = new URL(baseUrl).hostname;
  } catch {
    return null;
  }
  for (const [motif, transport] of HOTES) if (motif.test(hote)) return transport;
  return null;
}

/**
 * Determine le transport, et REFUSE la contradiction.
 *
 * Le cas qui justifie cette fonction n'est pas la configuration absente —
 * c'est la configuration incoherente : une base `graph.facebook.com` avec une
 * cle 360dialog produit des HTTP 401 qu'on passe une soiree a imputer a la
 * cle. Ici, le service ne demarre pas, et il dit pourquoi.
 *
 * La declaration reste FACULTATIVE quand l'hote suffit a trancher : les
 * deploiements existants n'ont pas de variable a ajouter, et ne tombent pas au
 * premier redemarrage.
 */
export function resoudreTransport(declare: string | undefined, baseUrl: string): TransportWhatsapp {
  const deduit = depuisLaBase(baseUrl);
  const dit = declare?.trim().toLowerCase();

  if (dit && dit !== "360dialog" && dit !== "meta") {
    throw new Error(
      `WABOT_TRANSPORT vaut « ${dit} » : les seules valeurs sont « 360dialog » et « meta ». ` +
        "Voir .env.example, section « bot WhatsApp ».",
    );
  }
  if (dit && deduit && dit !== deduit) {
    throw new Error(
      `Configuration du bot WhatsApp incoherente : WABOT_TRANSPORT dit « ${dit} », ` +
        `mais WABOT_BASE_URL pointe un hote « ${deduit} ». L'un des deux est faux — ` +
        "corriger avant de demarrer plutot que d'envoyer avec la mauvaise authentification.",
    );
  }
  const retenu = (dit as TransportWhatsapp | undefined) ?? deduit;
  if (!retenu) {
    throw new Error(
      "Transport du bot WhatsApp indeterminable : WABOT_BASE_URL ne porte ni un hote " +
        "360dialog ni un hote Meta. Declarer WABOT_TRANSPORT (« 360dialog » ou « meta »). " +
        "Voir .env.example, section « bot WhatsApp ».",
    );
  }
  return retenu;
}

/** L'en-tete d'authentification, la seule chose que les deux ne partagent pas. */
export function entetesAuth(transport: TransportWhatsapp, cle: string): Record<string, string> {
  return transport === "meta" ? { Authorization: `Bearer ${cle}` } : { "D360-API-KEY": cle };
}
