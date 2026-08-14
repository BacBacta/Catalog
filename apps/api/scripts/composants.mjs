/**
 * Les composants conversationnels du numero, et la mesure de `cta_url`.
 *
 *   node apps/api/scripts/composants.mjs --accueil-etat   → ce qui est pose
 *   node apps/api/scripts/composants.mjs --accueil-poser  → pose les amorces
 *   node apps/api/scripts/composants.mjs --mesurer-cta +237… → mesure cta_url
 *   node apps/api/scripts/composants.mjs --apercu-carnet +237… → envoie le
 *       carnet REEL (celui que le domaine construit), pour le voir dans un fil
 *
 * ── Pourquoi ce script ────────────────────────────────────────────────────
 *
 * Deux besoins nes du banc du 13/08, et une meme discipline : **on mesure
 * avant de dependre**.
 *
 * 1. **Les amorces (« ice breakers »)** repondent a « la boutique doit
 *    interagir directement lorsque l'utilisateur se connecte, meme sans rien
 *    ecrire ». Elles s'affichent DANS WhatsApp, au premier ouvrage du fil,
 *    avant tout message — c'est Meta qui les rend, pas nous. Elles se posent
 *    sur le NUMERO, une fois, et valent pour toutes les conversations.
 *
 * 2. **`cta_url`** — le bouton qui remplacerait les URL brutes — est annonce
 *    dans les guides de Meta et ABSENT de la reference des messages
 *    (verifie le 13/08/2026). Une forme non confirmee ne se code pas : elle
 *    se mesure. Le mode `--mesurer-cta` envoie UN message a un numero donne
 *    et rend le verdict de l'API — accepte, ou refuse avec sa raison.
 *
 * Aucun mode n'agit tout seul : ils se lancent a la main, ou par l'operation
 * `depots-meta` qui les execute la ou vivent les secrets.
 */

const JETON = process.env.WABOT_API_KEY?.trim();
/* Le MEME nom que partout ailleurs (`server.ts`, `auth.ts`, `banc-essai.ts`) :
   inventer une seconde variable pour la meme chose est exactement ce qui a
   fait echouer la premiere execution, le 13/08/2026. */
const NUMERO_ID = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
const BASE = (process.env.WABOT_GRAPH_URL ?? "https://graph.facebook.com/v26.0").replace(/\/$/, "");
const mode = process.argv[2] ?? "--accueil-etat";

/**
 * Les amorces, en francais simple. Quatre au plus, 80 caracteres chacune —
 * bornes de Meta. Elles ne sont pas des slogans : chacune est un GESTE que
 * le bot sait deja executer, et le mot qu'elles envoient est celui que la
 * machine reconnait.
 */
const AMORCES = ["Je veux vendre", "Voir une boutique", "Où est ma commande ?", "Aide"];

const COMMANDES = [
  { command_name: "vendre", command_description: "Ouvrir ma boutique en deux minutes" },
  { command_name: "boutique", command_description: "Le menu de ma boutique" },
  { command_name: "suivi", command_description: "Où en est ma commande" },
  { command_name: "aide", command_description: "Les gestes qui marchent partout" },
];

function exigerJeton() {
  if (!JETON) {
    console.error("WABOT_API_KEY est exigee. Voir .env.example, section « bot WhatsApp ».");
    process.exit(1);
  }
}

function exigerNumero() {
  if (!NUMERO_ID) {
    console.error(
      "WHATSAPP_PHONE_NUMBER_ID est exigee pour ce mode : les composants se posent sur le NUMERO.",
    );
    process.exit(1);
  }
}

async function appel(chemin, options = {}) {
  const r = await fetch(`${BASE}${chemin}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${JETON}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const corps = await r.json().catch(() => null);
  return { ok: r.ok, statut: r.status, corps };
}

if (mode === "--accueil-etat") {
  exigerJeton();
  exigerNumero();
  const r = await appel(`/${NUMERO_ID}?fields=conversational_automation`);
  if (!r.ok) {
    console.error(
      `Lecture refusee (HTTP ${r.statut}) : ${r.corps?.error?.message ?? "raison non dite"}`,
    );
    console.error("On ne conclut RIEN d'une lecture qui echoue — surtout pas « rien n'est pose ».");
    process.exit(1);
  }
  const a = r.corps?.conversational_automation ?? {};
  const amorces = a.prompts ?? [];
  const commandes = a.commands ?? [];
  console.log(`\nAmorces posees : ${amorces.length}`);
  for (const p of amorces) console.log(`  · ${p}`);
  console.log(`\nCommandes posees : ${commandes.length}`);
  for (const c of commandes) console.log(`  /${c.command_name} — ${c.command_description}`);
  console.log(
    amorces.length === 0
      ? "\nRien n'est pose : le fil s'ouvre vide, l'acheteuse doit deviner quoi ecrire."
      : "\nPour remplacer : node apps/api/scripts/composants.mjs --accueil-poser",
  );
} else if (mode === "--accueil-poser") {
  exigerJeton();
  exigerNumero();
  /* Les bornes de Meta, verifiees ICI plutot que promises : un depot refuse
     pour un caractere de trop est un aller-retour perdu. */
  const trop = AMORCES.filter((p) => p.length > 80);
  if (AMORCES.length > 4 || trop.length > 0) {
    console.error("Amorces hors bornes (4 au plus, 80 caracteres chacune) :", trop);
    process.exit(1);
  }
  const r = await appel(`/${NUMERO_ID}/conversational_automation`, {
    method: "POST",
    body: JSON.stringify({ prompts: AMORCES, commands: COMMANDES }),
  });
  if (!r.ok) {
    console.error(
      `Depot refuse (HTTP ${r.statut}) : ${r.corps?.error?.message ?? "raison non dite"}`,
    );
    process.exit(1);
  }
  console.log(`✅ ${AMORCES.length} amorce(s) et ${COMMANDES.length} commande(s) posees.`);
  console.log("Elles s'affichent au PREMIER ouvrage du fil, avant tout message.");
} else if (mode === "--mesurer-cta") {
  exigerJeton();
  exigerNumero();
  const vers = (process.argv[3] ?? "").replace(/\D/g, "");
  if (!vers) {
    console.error(
      "Un numero destinataire est exige : node apps/api/scripts/composants.mjs --mesurer-cta +237…",
    );
    console.error("La mesure ENVOIE un vrai message — c'est le seul moyen de savoir.");
    process.exit(1);
  }

  /**
   * La forme documentee dans les GUIDES, absente de la reference. C'est
   * exactement ce qu'on mesure : Meta l'accepte-t-il sur notre numero ?
   */
  const message = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: "Mesure Catalog : ce bouton remplace-t-il une URL brute ?" },
      action: {
        name: "cta_url",
        parameters: { display_text: "Ouvrir la boutique", url: "https://catalog.cm" },
      },
    },
  };

  const r = await appel(`/${NUMERO_ID}/messages`, {
    method: "POST",
    body: JSON.stringify(message),
  });
  if (r.ok) {
    console.log("✅ MESURE : `cta_url` est ACCEPTE sur ce numero.");
    console.log("   Les liens bruts du fil peuvent devenir des boutons.");
    console.log(`   Identifiant du message : ${r.corps?.messages?.[0]?.id ?? "non rendu"}`);
  } else {
    console.log("⛔ MESURE : `cta_url` est REFUSE.");
    console.log(`   HTTP ${r.statut} — ${r.corps?.error?.message ?? "raison non dite"}`);
    console.log(
      `   Code : ${r.corps?.error?.code ?? "?"} / ${r.corps?.error?.error_subcode ?? "?"}`,
    );
    console.log("   Conclusion : on garde les URL en texte, et on l'ecrit dans l'ADR.");
  }
} else if (mode === "--apercu-carnet") {
  exigerJeton();
  /* `exigerNumero` VALIDE l'identifiant de notre numero emetteur et ne rend
     rien. Le destinataire, lui, se lit dans les arguments — comme pour
     `--mesurer-cta`. Confondre les deux fait echouer l'envoi en disant
     « numero destinataire exige » alors qu'il a bien ete passe. */
  exigerNumero();
  const vers = (process.argv[3] ?? "").replace(/\D/g, "");
  if (!vers) {
    console.error(
      "Un numero destinataire est exige : node apps/api/scripts/composants.mjs --apercu-carnet +237…",
    );
    process.exit(1);
  }

  /**
   * ── L'APERCU du carnet, construit par le DOMAINE ────────────────────────
   *
   * Ce mode envoie le second message de confirmation — le carnet d'adresses,
   * celui dont le lien de suivi est devenu un bouton (ADR 0098).
   *
   * Il ne recopie AUCUNE chaine : il appelle `confirmationCommande`, la
   * fonction que le bot appelle en production, et n'envoie que ce qu'elle
   * rend. C'est la meme discipline que le harnais d'audit (ADR 0089) — un
   * apercu qui recopierait la copie montrerait ce qu'on croit ecrire, jamais
   * ce qu'on ecrit.
   *
   * Les donnees sont plausibles et FAUSSES, et le premier message — le
   * document de commande — n'est deliberement PAS envoye : une fausse
   * reference et un faux code de verification chez quelqu'un ressembleraient a
   * une vraie commande. On ne montre que ce qui a change.
   */
  const { confirmationCommande } = await import("../src/domain/bot/conversation.ts");
  const messages = confirmationCommande(vers, {
    reference: "CT-APERCU",
    codeVerification: "ACDE-4679",
    boutique: "Chez Bea",
    lignes: [{ nom: "Robe wax", quantite: 1, prixUnitaireXaf: 15000 }],
    totalXaf: 15000,
    /* Un acompte, pour que l'apercu montre le CONTRASTE : le suivi devient un
       bouton, la page de verification reste en texte juste en dessous. Sans
       acompte, cette seconde ligne n'existe pas et l'apercu ne dirait que la
       moitie de la regle (ADR 0098). */
    duAvantXaf: 7500,
    livraison: { mode: "retrait", pickupPoint: "Marché central", phone: "+237690112233" },
    lienSuivi: "https://catalog.cm/suivi/apercu",
    lienVerification: "https://catalog.cm/v/?c=ACDE-4679",
    waVendeuse: "https://wa.me/237677123456",
  });

  const carnet = messages[1];
  if (!carnet) {
    console.error("Le domaine n'a rendu aucun carnet — rien a montrer.");
    process.exit(1);
  }
  console.log(`forme rendue par le domaine : ${carnet.type}/${carnet.interactive?.type ?? "—"}`);

  const r = await appel(`/${NUMERO_ID}/messages`, {
    method: "POST",
    body: JSON.stringify(carnet),
  });
  if (r.ok) {
    console.log("✅ Carnet envoye — regardez le fil.");
    console.log(`   Identifiant du message : ${r.corps?.messages?.[0]?.id ?? "non rendu"}`);
  } else {
    console.log(`⛔ Refuse : HTTP ${r.statut} — ${r.corps?.error?.message ?? "raison non dite"}`);
    process.exit(1);
  }
} else {
  console.error(
    `mode inconnu : ${mode}. Utilisez --accueil-etat, --accueil-poser, --mesurer-cta <numero> ou --apercu-carnet <numero>.`,
  );
  process.exit(1);
}
