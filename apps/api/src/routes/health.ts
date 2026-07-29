import { Hono } from "hono";

export const health = new Hono().get("/", (c) =>
  c.json({ status: "ok", service: "swap-api", ts: new Date().toISOString() }),
);
