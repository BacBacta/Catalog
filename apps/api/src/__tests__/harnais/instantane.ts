import type { MessageSortant } from "../../domain/bot/messages.ts";
import type { Scene, Tour } from "./pilote.ts";

/**
 * L'ENREGISTREUR du harnais — audit de pipeline, phase 2.
 *
 * ── Ce qu'il rend possible ────────────────────────────────────────────────
 *
 * Une regression de copie — un bouton qui disparait, une question qui cesse
 * d'etre posee, un message qui devient muet — ne se voit pas dans une assertion
 * ciblee : elle se voit dans un DIFF. Ce module transcrit un scenario entier en
 * texte, et les scenarios le comparent a un instantane versionne.
 *
 * ── Pourquoi la neutralisation est la moitie du travail ───────────────────
 *
 * Les references de commande, les codes de verification, les jetons de suivi et
 * les numeros de test changent a chaque execution : sans neutralisation,
 * l'instantane serait rouge a chaque passage et cesserait d'etre lu — le sort
 * de tous les tests qui crient trop. La neutralisation est donc EXHAUSTIVE et
 * ORDONNEE : le code de verification se remplace avant la reference, sinon le
 * motif de la reference mordrait dedans.
 *
 * Ce qui est neutralise est REMPLACE par un jeton lisible, jamais efface : un
 * message qui perdrait sa reference doit se voir dans le diff comme une perte,
 * pas comme une absence de bruit.
 *
 * Module PUR : il transforme des objets en texte.
 */

function corpsDe(m: MessageSortant): string {
  const x = m as {
    type: string;
    text?: { body?: string };
    interactive?: { body?: { text?: string }; footer?: { text?: string } };
    image?: { caption?: string; link?: string };
    reaction?: { emoji?: string };
    template?: { name?: string; components?: unknown };
  };
  if (x.type === "text") return x.text?.body ?? "";
  if (x.type === "interactive") return x.interactive?.body?.text ?? "";
  if (x.type === "image") return x.image?.caption ?? "(sans légende)";
  if (x.type === "reaction") return `réaction ${x.reaction?.emoji ?? ""}`;
  if (x.type === "template") return `gabarit ${x.template?.name ?? "?"}`;
  return "";
}

function formeDe(m: MessageSortant): string {
  const x = m as {
    type: string;
    interactive?: {
      type: string;
      action?: {
        buttons?: Array<{ reply: { id: string; title: string } }>;
        sections?: Array<{ rows: Array<{ id: string; title: string }> }>;
        name?: string;
        parameters?: { flow_cta?: string; display_text?: string; url?: string };
      };
      footer?: { text?: string };
      header?: { type?: string };
    };
    image?: { link?: string };
  };
  if (x.type === "text") return "texte";
  if (x.type === "image") return "image";
  if (x.type === "reaction") return "réaction";
  if (x.type === "template") return "gabarit";
  if (x.type !== "interactive") return x.type;

  const i = x.interactive;
  if (i?.type === "button") {
    const ids = (i.action?.buttons ?? []).map((b) => b.reply.id).join(" · ");
    const entete = i.header?.type === "image" ? " +image" : "";
    return `boutons[${ids}]${entete}`;
  }
  if (i?.type === "list") {
    const lignes = (i.action?.sections ?? []).flatMap((s) => s.rows).map((r) => r.id);
    return `liste[${lignes.join(" · ")}]`;
  }
  if (i?.type === "flow") return `formulaire(${i.action?.parameters?.flow_cta ?? "?"})`;
  if (i?.type === "location_request_message") return "demande de position";
  /**
   * Le bouton-lien rend son LIBELLE et son URL — ADR 0097.
   *
   * Sans eux, la transcription montrerait `cta_url` et un corps de message
   * d'ou l'URL vient justement de partir : l'instantane cesserait de voir la
   * seule chose que la conversion a deplacee. Un livrable qui perd de vue ce
   * qui vient de changer ne sert plus a rien.
   */
  if (i?.type === "cta_url") {
    const p = i.action?.parameters;
    return `bouton-lien[${p?.display_text ?? "?"} → ${p?.url ?? "?"}]`;
  }
  return i?.type ?? "interactif";
}

/**
 * Les remplacements, dans l'ordre. L'ordre EST le contrat : le code de
 * verification (`ABCD-1234`) et la reference (`CT-104312`) se ressemblent assez
 * pour que l'un morde l'autre si on les inverse.
 */
export function neutraliser(texte: string, scene: Scene): string {
  let t = texte;
  /* Les valeurs propres a la scene d'abord : elles sont litterales, donc sures. */
  t = t.split(scene.slug).join("‹slug›");
  t = t.split(scene.nomBoutique).join("‹boutique›");
  t = t.split(scene.vendeuseWaId).join("‹tel-vendeuse›");
  t = t.split(scene.acheteuseWaId).join("‹tel-acheteuse›");
  for (const a of scene.articles) t = t.split(a.id).join("‹article›");

  /* Puis les formes generiques. */
  t = t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "‹uuid›");
  t = t.replace(/\bCT-\d{6}\b/g, "CT-‹ref›");
  /* Le code de verification : l'alphabet non ambigu du lot 3, en deux blocs. */
  t = t.replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, "‹code›");
  /* Les jetons de suivi et de verification, dans les liens. */
  t = t.replace(/([?&](?:t|c|jeton|token)=)[A-Za-z0-9_-]+/g, "$1‹jeton›");
  t = t.replace(/(\/suivi\/)[A-Za-z0-9_-]+/g, "$1‹jeton›");
  /**
   * Les slugs CREES PENDANT le scenario.
   *
   * Une boutique nee dans le fil prend le slug de son nom, suffixe d'un compteur
   * quand il est deja pris (`chez-solange-2`). Ce compteur depend de ce que la
   * base contient DEJA : il change a chaque execution, et sans cette regle
   * l'instantane rougirait a chaque passage — donc cesserait d'etre lu.
   *
   * Seulement dans les LIENS. Le premier jet neutralisait aussi « boutique »
   * suivi d'un mot, et transformait « Votre boutique en ligne » en « Votre
   * boutique ‹slug› ligne » : une neutralisation qui abime la copie detruit
   * exactement ce que l'instantane doit proteger.
   */
  t = t.replace(/(boutique%20)[a-z0-9][a-z0-9-]*/g, "$1‹slug›");
  /**
   * Les ROUTES ne sont pas des slugs, et les confondre coute cher : le
   * deuxieme jet ecrivait `boutique.test/‹slug›?numero=…` la ou le produit dit
   * `/payer`, et `‹slug›/?c=` la ou il dit `/v/`. L'instantane cachait donc
   * exactement ce qu'il existe pour proteger — une URL de paiement ou de
   * verification qui changerait passerait inapercue. La liste est fermee, et
   * elle doit grandir avec les routes de la boutique.
   */
  t = t.replace(
    /(boutique\.test\/)(?!payer\b|suivi\b|v\b|recu\b|avis\b|commande\b)[a-z0-9][a-z0-9-]*/g,
    "$1‹slug›",
  );

  /* Les numeros camerounais restants — ceux des fixtures partagees. */
  t = t.replace(/\+?237\s?\d[\d\s]{7,}\d/g, "‹tel›");
  /* Les dates absolues : un instantane ne doit pas rougir a minuit. */
  t = t.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "‹date›");
  t = t.replace(/\b\d{2}:\d{2}\b/g, "‹heure›");
  return t;
}

function rendreMessage(m: MessageSortant, scene: Scene): string {
  const corps = neutraliser(corpsDe(m), scene).split("\n").join("\n      ");
  /* La FORME aussi passe par la neutralisation : les identifiants de boutons
     portent l'uuid de l'article (`cmd:019ffd07-…`), qui change a chaque
     execution. Ne neutraliser que le corps laissait l'instantane rouge un
     passage sur deux — et un instantane qui crie sans raison cesse d'etre lu. */
  return `    ← ${neutraliser(formeDe(m), scene)}\n      ${corps}`;
}

/**
 * Un scenario entier, en texte lisible.
 *
 * Le format est fait pour le DIFF, pas pour la beaute : une ligne par fait, le
 * geste puis ses consequences, et l'etape avant/apres a chaque tour — c'est
 * elle qui rend visible une transition qui change.
 */
export function transcrire(titre: string, tours: readonly Tour[], scene: Scene): string {
  const lignes: string[] = [`# ${titre}`, ""];
  for (const t of tours) {
    /* Le libelle porte ce que la personne a TAPE — donc parfois le slug de la
       scene, qui change a chaque execution. Sans cette neutralisation,
       l'instantane rougit a chaque passage et cesse d'etre lu : le sort de tous
       les tests qui crient trop. */
    lignes.push(`## ${t.rang}. ${neutraliser(t.geste.libelle, scene)}`);
    lignes.push(`   intention : ${t.geste.intention}`);
    lignes.push(
      `   étape : ${t.etapeAvant}${t.etapeApres === t.etapeAvant ? " (inchangée)" : ` → ${t.etapeApres}`}`,
    );
    if (t.geste.attente) {
      const minutes = Math.round(t.geste.attente / 60_000);
      lignes.push(`   temps écoulé : ${minutes} min`);
    }
    if (t.muet) {
      /* Le fait le plus important que ce harnais puisse enregistrer : la
         personne a fait un geste et n'a RIEN recu. */
      lignes.push("   ⚠ MUET — aucun message émis");
    } else {
      for (const m of t.messages) lignes.push(rendreMessage(m, scene));
    }
    lignes.push("");
  }
  return lignes.join("\n");
}

/** Les tours restes muets — la matiere premiere des constats « silence ». */
export function toursMuets(tours: readonly Tour[]): Tour[] {
  return tours.filter((t) => t.muet);
}
