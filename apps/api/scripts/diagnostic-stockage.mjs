#!/usr/bin/env node
/**
 * DIAGNOSTIC du stockage d'objets — lecture, plus une sonde jetable.
 *
 * ── Pourquoi il existe ────────────────────────────────────────────────────
 *
 * Le 15/08/2026 au soir, trois faits se contredisaient :
 *
 *   1. l'article entrait en base AVEC sa cle d'image, donc `put()` n'avait pas
 *      leve — et il ne peut pas echouer en silence, le SDK leve ;
 *   2. le bucket etait rapporte VIDE ;
 *   3. le bot ne retrouvait pas son propre objet (`urlJpegVerifiee` rendait
 *      `null`), donc « Voir les photos » n'affichait rien.
 *
 * Trois hypotheses restaient debout, et AUCUNE trace ne permettait de choisir :
 * l'application ecrit dans un AUTRE bucket que celui qu'on regarde ; les
 * droits de la cle autorisent `PutObject` mais pas `HeadObject`/`GetObject` ;
 * ou l'endpoint accepte et jette. `taille()` les confond toutes — son `catch`
 * rend `null` pour « objet absent » comme pour « droits insuffisants ».
 *
 * Cette sonde les separe.
 *
 * ── Ce qu'elle imprime, et ce qu'elle n'imprime JAMAIS ────────────────────
 *
 * Elle imprime l'HOTE de l'endpoint, le NOM du bucket et la region : des
 * identifiants de configuration, deja ecrits en clair dans
 * `docs/runbooks/deploiement.md`. Elle n'imprime jamais `S3_ACCESS_KEY` ni
 * `S3_SECRET_KEY`, ni le contenu d'un objet — sa sortie atterrit dans un
 * journal d'integration continue, lisible par qui a acces au depot (meme
 * regime que l'inventaire et que les traces, ADR 0023).
 *
 * ── La sonde jetable ──────────────────────────────────────────────────────
 *
 * Un objet minuscule, sous un prefixe `diagnostic/`, ecrit puis relu puis
 * SUPPRIME. C'est le seul moyen de distinguer « je ne sais pas ecrire » de
 * « je ne sais pas relire ce que j'ecris » — et chaque etape se dit
 * separement, parce que c'est precisement leur confusion qui a coute la
 * soiree.
 *
 * Usage : node apps/api/scripts/diagnostic-stockage.mjs
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const ATTENDUES = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"];
const manquantes = ATTENDUES.filter((k) => !process.env[k]);
if (manquantes.length > 0) {
  console.error(`Stockage NON configure. Variables absentes : ${manquantes.join(", ")}.`);
  console.error("L'application tourne alors en stockage MEMOIRE — les photos");
  console.error("disparaissent au redemarrage, et aucun objet n'atteint le bucket.");
  process.exit(1);
}

const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION || "(vide → auto)";

/** L'hote seul : ni identifiant, ni jeton dans une URL d'endpoint. */
const hote = (() => {
  try {
    return new URL(endpoint).host;
  } catch {
    return "(S3_ENDPOINT n'est pas une URL valide)";
  }
})();

console.log("── Configuration lue par l'application ──────────────────");
console.log(`  endpoint (hote) : ${hote}`);
console.log(`  bucket          : ${bucket}`);
console.log(`  region          : ${region}`);
console.log("  cles d'acces    : presentes (jamais imprimees)");
console.log("");

const client = new S3Client({
  endpoint,
  region: process.env.S3_REGION || "auto",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

/** Rend un message d'erreur COURT : nom, code HTTP, code du fournisseur. */
const bref = (e) => {
  const http = e?.$metadata?.httpStatusCode;
  return [e?.name, e?.Code, http ? `HTTP ${http}` : null].filter(Boolean).join(" · ") || "inconnu";
};

console.log("── Ce que le bucket contient, vu par l'application ──────");
let listageOk = false;
try {
  const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 20 }));
  listageOk = true;
  const n = r.KeyCount ?? 0;
  console.log(`  objets listes : ${n}${r.IsTruncated ? " (tronque a 20)" : ""}`);
  for (const o of r.Contents ?? []) {
    console.log(`    ${o.Key}  ${o.Size} octets  ${o.LastModified?.toISOString() ?? ""}`);
  }
  if (n === 0) {
    console.log("    (aucun objet — le bucket que l'application vise est VIDE)");
  }
} catch (e) {
  console.log(`  ECHEC du listage : ${bref(e)}`);
  console.log("  Note : un listage refuse n'est pas une preuve de bucket vide.");
}

console.log("");
console.log("── Sonde jetable : ecrire, relire, effacer ──────────────");
const cle = `diagnostic/sonde-${process.env.FLY_ALLOC_ID?.slice(0, 8) ?? "local"}.txt`;
const corps = new TextEncoder().encode("sonde de diagnostic — sans valeur");

let ecrit = false;
try {
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: cle, Body: corps, ContentType: "text/plain" }),
  );
  ecrit = true;
  console.log(`  1. ecriture   : OK (${cle})`);
} catch (e) {
  console.log(`  1. ecriture   : ECHEC — ${bref(e)}`);
}

if (ecrit) {
  try {
    const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: cle }));
    console.log(`  2. relecture d'entete : OK (${r.ContentLength} octets)`);
  } catch (e) {
    console.log(`  2. relecture d'entete : ECHEC — ${bref(e)}`);
    console.log("     C'est CE cas que `taille()` confond avec « objet absent » :");
    console.log("     le bot renonce alors a la photo en croyant qu'elle n'existe pas.");
  }

  try {
    const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: cle }));
    const octets = await r.Body?.transformToByteArray();
    console.log(`  3. lecture du corps   : OK (${octets?.length ?? 0} octets)`);
  } catch (e) {
    console.log(`  3. lecture du corps   : ECHEC — ${bref(e)}`);
  }

  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: cle }));
    console.log("  4. effacement : OK — rien ne reste de la sonde");
  } catch (e) {
    console.log(`  4. effacement : ECHEC — ${bref(e)} (objet laisse sous diagnostic/)`);
  }
}

console.log("");
console.log("── Lecture ──────────────────────────────────────────────");
if (!listageOk) {
  console.log("  Listage refuse : comparer le NOM du bucket ci-dessus avec celui");
  console.log("  regarde dans la console du fournisseur — c'est la premiere piste.");
} else {
  console.log("  Le bucket ci-dessus est bien celui ou l'application ecrit. Si la");
  console.log("  console du fournisseur en montre un autre, ce sont deux buckets.");
}
