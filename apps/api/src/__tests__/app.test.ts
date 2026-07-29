import { describe, expect, it } from "vitest";
import app from "../app.ts";

describe("api", () => {
  it("repond sur /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("l'URL de notification repond au GET (test de disponibilite agregateur)", async () => {
    const res = await app.request("/webhooks/payment");
    expect(res.status).toBe(200);
  });
});
