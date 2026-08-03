import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { vehiclePl } from "../db/schema";
import { buildGridResponse } from "./gridService";
import { requirePermission, requireSession } from "../middleware/roleGuard";
import type { AppEnv } from "../hono-env";

export const gridRoute = new Hono<AppEnv>();

/** F1 月次収支グリッド (S2画面): 車両×51列 */
gridRoute.get("/", requireSession(), requirePermission("view"), async (c) => {
  const yearMonth = c.req.query("yearMonth");
  if (!yearMonth) {
    return c.json({ error: "yearMonth is required (YYYY-MM)" }, 400);
  }

  const db = drizzle(c.env.DB);
  const rows = await db
    .select()
    .from(vehiclePl)
    .where(eq(vehiclePl.yearMonth, yearMonth))
    .all();

  // このスライスでは異常検知は別バッチ実行(F7)想定のため、グリッド表示時は空配列で返す。
  // review_flag テーブルと結合してハイライトする実装は次スライスで拡張する。
  const response = buildGridResponse(
    yearMonth,
    rows.map((r) => ({ ...r, vehicleNo: r.vehicleNo })),
    [],
  );
  return c.json(response);
});
