import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { reviewFlag } from "../db/schema";
import { buildTodoResponse } from "./todoService";
import { requirePermission, requireSession } from "../middleware/roleGuard";
import type { AppEnv } from "../hono-env";

export const todoRoute = new Hono<AppEnv>();

/** F2 今月のToDoボード (S1画面): 未入力・要確認カードの一覧 */
todoRoute.get("/", requireSession(), requirePermission("view"), async (c) => {
  const yearMonth = c.req.query("yearMonth");
  if (!yearMonth) {
    return c.json({ error: "yearMonth is required (YYYY-MM)" }, 400);
  }

  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(reviewFlag)
    .where(eq(reviewFlag.yearMonth, yearMonth))
    .all();

  const response = buildTodoResponse(
    yearMonth,
    rows.map((r) => ({
      id: r.id,
      yearMonth: r.yearMonth,
      vehicleNo: r.vehicleNo,
      field: r.field,
      type: r.type,
      severity: (r.severity as "info" | "warning" | "critical") ?? "info",
      message: r.message,
      monthlyReference: r.monthlyReference,
      status: r.status,
    })),
  );
  return c.json(response);
});

/** 要確認カードを「修正/実績として承認」の2択で捌く (要件定義L4-2) */
todoRoute.post(
  "/:id/resolve",
  requireSession(),
  requirePermission("approve_anomaly"),
  async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{
      action: "corrected" | "approved" | "dismissed";
      note?: string;
    }>();

    if (!id) {
      return c.json({ error: "id is required" }, 400);
    }

    const session = c.get("session");
    const db = drizzle(c.env.DB);
    await db
      .update(reviewFlag)
      .set({
        status: body.action,
        resolvedBy: session?.user?.id ?? null,
        resolvedAt: new Date(),
        resolutionNote: body.note ?? null,
      })
      .where(eq(reviewFlag.id, id))
      .run();

    return c.json({ ok: true });
  },
);
