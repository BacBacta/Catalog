#!/usr/bin/env node
import { appendFileSync } from "node:fs";
/**
 * Capteur de webhook — relève VERBATIM ce que CamPay envoie.
 *
 *   node apps/api/scripts/webhook-capture.mjs
 *   npx localtunnel --port 8899     (ou ngrok http 8899)
 *
 * Puis collez l'URL publique dans la configuration webhook du tableau de
 * bord CamPay, et déclenchez un paiement.
 *
 * Ce script ne fait AUCUNE hypothèse : il consigne les en-têtes, le corps
 * brut et le corps analysé, dans le terminal et dans un fichier. C'est
 * exactement ce qu'il faut pour écrire la vérification de signature.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8899);
const OUT = "campay-webhooks.log";
let n = 0;

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    n++;
    const entry = {
      n,
      at: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: req.headers,
      rawBody: raw,
      parsed: (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })(),
    };

    console.log(`\n══════ webhook #${n} — ${entry.at} ══════`);
    console.log(`${req.method} ${req.url}`);
    console.log("\n--- EN-TÊTES ---");
    for (const [k, v] of Object.entries(req.headers)) {
      const suspect = /sign|hash|hmac|auth|token|digest/i.test(k);
      console.log(`  ${suspect ? "🔑 " : "   "}${k}: ${v}`);
    }
    console.log("\n--- CORPS BRUT (à signer tel quel) ---");
    console.log(raw || "(vide)");
    if (entry.parsed) {
      console.log("\n--- CHAMPS ---");
      const flat = (o, p = "") => {
        for (const [k, v] of Object.entries(o)) {
          if (v && typeof v === "object") flat(v, `${p}${k}.`);
          else console.log(`  ${p}${k} = ${JSON.stringify(v)}`);
        }
      };
      flat(entry.parsed);
    }
    const sig = Object.keys(req.headers).filter((h) => /sign|hash|hmac|digest/i.test(h));
    console.log(
      sig.length
        ? `\n✓ En-tête de signature détecté : ${sig.join(", ")}`
        : `\n⚠ Aucun en-tête de signature. Les webhooks ne sont pas authentifiés — ne jamais leur faire avancer un paiement sans re-vérification via checkStatus.`,
    );

    appendFileSync(OUT, JSON.stringify(entry) + "\n");
    // Toujours répondre 200 immédiatement : sinon l'agrégateur rejoue.
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
  });
}).listen(PORT, () => {
  console.log(`Capteur en écoute sur http://localhost:${PORT}`);
  console.log(`Journal : ${OUT}`);
  console.log(`\nExposez-le (localtunnel ou ngrok), collez l'URL dans CamPay, puis payez.`);
});
