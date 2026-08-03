import { Hono } from "hono";
import { createAuth } from "./auth";
import { gridRoute } from "./routes/grid";
import { todoRoute } from "./routes/todo";
import { requireSession } from "./middleware/roleGuard";
import type { AppEnv } from "./hono-env";

const app = new Hono<AppEnv>();

// Better Auth ハンドラ (/api/auth/*)。SPA配信時のOAuthコールバック横取り対策として
// wrangler.jsonc の assets.run_worker_first に "/api/*" を必ず含める(既に設定済み)。
app.on(["GET", "POST", "PATCH", "PUT", "DELETE"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);

// ログイン中ユーザー情報 (S1等のUIがロール表示に使う)
app.get("/api/me", requireSession(), (c) => {
  const session = c.get("session");
  return c.json({ user: session?.user ?? null });
});

app.route("/api/vehicle-pl", gridRoute);
app.route("/api/todo", todoRoute);

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
