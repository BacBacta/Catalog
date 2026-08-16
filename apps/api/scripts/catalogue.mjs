#!/usr/bin/env node
/**
 * Le catalogue Commerce Manager — ADR 0108.
 *
 *   node apps/api/scripts/catalogue.mjs --etat           → mesure, sans rien ecrire
 *   node apps/api/scripts/catalogue.mjs --deposer        → cree le catalogue et le relie au WABA
 *   node apps/api/scripts/catalogue.mjs --synchroniser   → pousse TOUTES les fiches depuis la base
 *
 * ── Pourquoi la mesure vient d'abord ──────────────────────────────────────
 *
 * Trois inconnues sont dites dans l'ADR 0108, et aucune ne se suppose :
 * la PORTEE du jeton (les Flows demandent `whatsapp_business_management`,
 * le catalogue demande `catalog_management` et `business_management`), la
 * disponibilite du commerce sur ce WABA, et le format exact des fiches.
 * `--etat` repond aux deux premieres ; le rapport d'erreurs par fiche que
 * Meta rend apres chaque lot repond a la troisieme.
 *
 * Meme regle que `flux.mjs` : `--deposer` est un acte SORTANT et durable,
 * il ne part jamais tout seul. Et comme la sonde de stockage (ADR 0105),
 * chaque etape se dit separement — c'est leur confusion qui coute des
 * soirees.
 *
 * Rien d'imprime n'est un secret : identifiants de configuration, comptes,
 * verdicts. Jamais le jeton.
 */

const JETON = process.env.WABOT_API_KEY?.trim();
const WABA = process.env.WHATSAPP_WABA_ID?.trim();
const BASE = (process.env.WABOT_GRAPH_URL ?? "https://graph.facebook.com/v26.0").replace(/\/$/, "");
const mode = process.argv[2] ?? "--etat";

if (!JETON) {
  console.error("WABOT_API_KEY absent : rien a faire ici sans jeton Graph.");
  process.exit(1);
}
if (!WABA) {
  console.error("WHATSAPP_WABA_ID absent : le catalogue se relie a un WABA, il le faut.");
  process.exit(1);
}

const NOM_CATALOGUE = "Catalog — boutiques";

/** Un appel Graph, borne, qui rend { ok, statut, corps } sans jamais lever. */
async function graph(chemin, options = {}) {
  const url = chemin.startsWith("http") ? chemin : `${BASE}/${chemin}`;
  try {
    const r = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${JETON}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const corps = await r.json().catch(() => ({}));
    return { ok: r.ok, statut: r.status, corps };
  } catch (e) {
    return { ok: false, statut: 0, corps: { error: { message: String(e?.message ?? e) } } };
  }
}

const erreurDe = (r) => r.corps?.error?.message ?? `HTTP ${r.statut}`;

/**
 * ── La mesure, etape par etape ────────────────────────────────────────────
 *
 * 1. Qui est ce jeton, et quelles PORTEES porte-t-il vraiment.
 * 2. Quelle entreprise (Business) possede le WABA.
 * 3. Quels catalogues cette entreprise possede deja.
 * 4. Lequel est deja RELIE au WABA — c'est lui que les messages utiliseront.
 */
async function etat() {
  console.log("── 1. Le jeton ──────────────────────────────────────────");
  const debug = await graph(`debug_token?input_token=${encodeURIComponent(JETON)}`);
  if (debug.ok) {
    const d = debug.corps?.data ?? {};
    const portees = Array.isArray(d.scopes) ? d.scopes : [];
    console.log(`  type : ${d.type ?? "?"} — valide : ${d.is_valid === true ? "oui" : "non"}`);
    console.log(`  portees : ${portees.join(", ") || "(aucune listee)"}`);
    for (const requise of ["catalog_management", "business_management"]) {
      const la = portees.includes(requise);
      console.log(
        `  ${la ? "✓" : "✗"} ${requise}${la ? "" : "  ← A AJOUTER au jeton (console Meta, utilisateur systeme)"}`,
      );
    }
  } else {
    console.log(`  debug_token refuse : ${erreurDe(debug)} — les portees restent inconnues.`);
  }

  console.log("");
  console.log("── 2. L'entreprise proprietaire du WABA ─────────────────");
  const waba = await graph(`${WABA}?fields=name,owner_business_info`);
  const business = waba.corps?.owner_business_info?.id ?? null;
  if (waba.ok) {
    console.log(`  WABA : ${waba.corps?.name ?? "?"} (${WABA})`);
    console.log(
      `  entreprise : ${waba.corps?.owner_business_info?.name ?? "?"} (${business ?? "?"})`,
    );
  } else {
    console.log(`  lecture du WABA refusee : ${erreurDe(waba)}`);
  }

  console.log("");
  console.log("── 3. Les catalogues de l'entreprise ────────────────────");
  if (business) {
    const cats = await graph(`${business}/owned_product_catalogs?fields=id,name,product_count`);
    if (cats.ok) {
      const liste = cats.corps?.data ?? [];
      if (liste.length === 0) console.log("  aucun — `--deposer` en creera un.");
      for (const c of liste) {
        console.log(`  ${c.id}  « ${c.name} »  ${c.product_count ?? "?"} fiche(s)`);
      }
    } else {
      console.log(`  listage refuse : ${erreurDe(cats)}`);
    }
  } else {
    console.log("  (sans entreprise lisible, pas de listage)");
  }

  console.log("");
  console.log("── 4. Le catalogue RELIE au WABA ────────────────────────");
  const relies = await graph(`${WABA}/product_catalogs?fields=id,name`);
  if (relies.ok) {
    const liste = relies.corps?.data ?? [];
    if (liste.length === 0) {
      console.log("  aucun — c'est le lien que `--deposer` posera.");
    }
    for (const c of liste) {
      console.log(`  ${c.id}  « ${c.name} »  ← WABOT_CATALOGUE_ID a poser avec cette valeur`);
    }
  } else {
    console.log(`  lecture refusee : ${erreurDe(relies)}`);
  }
}

/**
 * ── Le depot : creer s'il manque, relier s'il ne l'est pas ────────────────
 * Idempotent : un catalogue du meme nom est reutilise, un lien deja pose est
 * un succes. Rien n'est jamais supprime ici.
 */
async function deposer() {
  const waba = await graph(`${WABA}?fields=owner_business_info`);
  const business = waba.corps?.owner_business_info?.id;
  if (!business) {
    console.error(`Entreprise du WABA illisible : ${erreurDe(waba)}. Rien n'est fait.`);
    process.exit(1);
  }

  /* Deja relie ? Alors tout est en place. */
  const relies = await graph(`${WABA}/product_catalogs?fields=id,name`);
  const deja = (relies.corps?.data ?? [])[0];
  if (deja) {
    console.log(`Deja relie : ${deja.id} « ${deja.name} ». Rien a faire.`);
    console.log(`WABOT_CATALOGUE_ID=${deja.id}`);
    return;
  }

  /* Un catalogue du bon nom existe-t-il deja chez l'entreprise ? */
  const cats = await graph(`${business}/owned_product_catalogs?fields=id,name`);
  let catalogue = (cats.corps?.data ?? []).find((c) => c.name === NOM_CATALOGUE)?.id ?? null;
  if (catalogue) {
    console.log(`Catalogue existant reutilise : ${catalogue}`);
  } else {
    const cree = await graph(`${business}/owned_product_catalogs`, {
      method: "POST",
      body: JSON.stringify({ name: NOM_CATALOGUE, vertical: "commerce" }),
    });
    catalogue = cree.corps?.id ?? null;
    if (!catalogue) {
      console.error(`Creation refusee : ${erreurDe(cree)}. Rien n'est relie.`);
      process.exit(1);
    }
    console.log(`Catalogue cree : ${catalogue}`);
  }

  const lien = await graph(`${WABA}/product_catalogs`, {
    method: "POST",
    body: JSON.stringify({ catalog_id: catalogue }),
  });
  if (!lien.ok) {
    console.error(`Liaison au WABA refusee : ${erreurDe(lien)}.`);
    console.error("Le catalogue existe ; la liaison peut aussi se poser dans la console Meta.");
    process.exit(1);
  }
  console.log("Relie au WABA.");
  console.log("");
  console.log(`WABOT_CATALOGUE_ID=${catalogue}`);
  console.log(
    "→ a poser par l'operation `poser-flux-ids` (ou `fly secrets set`), puis `--synchroniser`.",
  );
}

/**
 * ── La synchronisation complete, depuis la base ───────────────────────────
 * Reprend exactement les regles du service (`synchroniserCatalogue`) : les
 * illustres seulement, prix entier XAF, disponibilite selon conges. Le
 * verdict PAR FICHE se lit ensuite aupres de Meta — c'est la troisieme
 * inconnue de l'ADR 0108, et c'est ici qu'elle se mesure.
 */
async function synchroniser() {
  const catalogue = process.env.WABOT_CATALOGUE_ID?.trim();
  const mediaBase = process.env.MEDIA_PUBLIC_BASE?.trim()?.replace(/\/$/, "");
  const boutiqueBase = process.env.BASE_BOUTIQUE_PUBLIQUE?.trim()?.replace(/\/$/, "");
  const manquantes = [
    !catalogue && "WABOT_CATALOGUE_ID",
    !mediaBase && "MEDIA_PUBLIC_BASE",
    !boutiqueBase && "BASE_BOUTIQUE_PUBLIQUE",
  ].filter(Boolean);
  if (manquantes.length > 0) {
    console.error(`Variables absentes : ${manquantes.join(", ")}. Rien ne part.`);
    process.exit(1);
  }

  const { createPrismaClient } = await import("@catalog/db");
  const prisma = createPrismaClient();
  const vendeuses = await prisma.seller.findMany({
    select: {
      slug: true,
      congesDepuis: true,
      products: {
        where: { archivedAt: null },
        orderBy: { position: "asc" },
        select: { id: true, name: true, priceXaf: true, description: true, imageKey: true },
      },
    },
  });
  await prisma.$disconnect();

  const requests = [];
  let sansPhoto = 0;
  for (const v of vendeuses) {
    for (const p of v.products) {
      if (!p.imageKey) {
        sansPhoto += 1;
        continue;
      }
      requests.push({
        method: "UPDATE",
        data: {
          id: p.id,
          title: p.name,
          description: p.description?.trim() || p.name,
          price: `${p.priceXaf} XAF`,
          availability: v.congesDepuis == null ? "in stock" : "out of stock",
          condition: "new",
          image_link: `${mediaBase}/${p.imageKey}.jpg`,
          link: `${boutiqueBase}/${v.slug}`,
        },
      });
    }
  }
  console.log(
    `${requests.length} fiche(s) a pousser, ${sansPhoto} article(s) sans photo laisses a la liste (ADR 0108).`,
  );
  if (requests.length === 0) return;

  const lot = await graph(`${catalogue}/items_batch`, {
    method: "POST",
    body: JSON.stringify({ item_type: "PRODUCT_ITEM", requests }),
  });
  if (!lot.ok) {
    console.error(`Lot refuse : ${erreurDe(lot)}`);
    process.exit(1);
  }
  const poignee = lot.corps?.handles?.[0];
  console.log(`Lot accepte${poignee ? ` (poignee ${poignee})` : ""}. Verdict par fiche :`);

  /* Meta traite le lot en asynchrone : on interroge le statut quelques
     secondes, et on imprime CHAQUE erreur de fiche — c'est le rapport qui
     repond a « quel champ manquait ». */
  if (poignee) {
    for (let essai = 0; essai < 10; essai++) {
      await new Promise((r) => setTimeout(r, 3000));
      const statut = await graph(
        `${catalogue}/check_batch_request_status?handle=${encodeURIComponent(poignee)}`,
      );
      const info = statut.corps?.data?.[0];
      if (!info) continue;
      const erreurs = info.errors ?? [];
      console.log(`  statut : ${info.status ?? "?"} — ${erreurs.length} erreur(s) de fiche`);
      for (const e of erreurs.slice(0, 20)) {
        console.log(
          `    fiche ${e.retailer_id ?? "?"} : ${e.message ?? JSON.stringify(e).slice(0, 160)}`,
        );
      }
      if (info.status === "finished") break;
    }
  }
  console.log("Fait. Les fiches se relisent dans la console Commerce Manager.");
}

if (mode === "--etat") await etat();
else if (mode === "--deposer") await deposer();
else if (mode === "--synchroniser") await synchroniser();
else {
  console.error(`Mode inconnu : ${mode}. Modes : --etat, --deposer, --synchroniser.`);
  process.exit(1);
}
