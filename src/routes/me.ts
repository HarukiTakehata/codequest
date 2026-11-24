import { Hono } from "hono";
import type { AppEnv } from "../context";
import { requireUser } from "../middleware/identity";
import { publicUser } from "./auth";

export const meRoutes = new Hono<AppEnv>();
meRoutes.get("/me", requireUser, (c) => c.json({ user: publicUser(c.get("user")) }));
meRoutes.get("/health", (c) => c.json({ ok: true, service: "codequest" }));
