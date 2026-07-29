import { describe, expect, it } from "vitest";
import app from "../app.ts";

describe("api", () => {
  it("repond sur /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  /** ADR 0009 : la v1 n'a aucun point d'entree de notification de paiement. */
  it("n'expose AUCUNE URL de notification de paiement", async () => {
    for (const url of ["/webhooks/payment", "/webhooks", "/webhook"]) {
      const res = await app.request(url);
      expect(res.status).toBe(404);
    }
  });
});
