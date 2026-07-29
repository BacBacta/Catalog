import { Hono } from "hono";

export const health = new Hono().get("/", (c) =>
  c.json({ status: "ok", service: "catalog-api", ts: new Date().toISOString() }),
);
