import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../src/infrastructure/db/client";
import { D1VehiclePlRepository } from "../../../src/infrastructure/db/D1VehiclePlRepository";
import {
  buildMonthlyPlCsv,
  monthlyPlCsvFileName,
} from "../../../src/usecase/steps/exportMonthlyPlCsv";
import type { VehiclePlField } from "../../../src/domain/entities/VehiclePl";
import { FIELD_LABELS } from "../../_lib/fieldLabels";

/**
 * 業務フロー STEP8「運送収支表への転記」の代替。
 * 収支表51列をそのままの並びでCSVに書き出す(Excelへ貼り付けるだけで済むようにする)。
 */
export async function GET(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "view")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const yearMonth = new URL(request.url).searchParams.get("yearMonth");
  if (!yearMonth) {
    return NextResponse.json({ error: "yearMonth is required" }, { status: 400 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const db = createDb(env.DB);
  const rows = await new D1VehiclePlRepository(db).findByYearMonth(yearMonth);

  const csv = buildMonthlyPlCsv(
    rows.map((r) => ({
      vehicleNo: r.no,
      values: r as unknown as Partial<Record<VehiclePlField, number | string | null>>,
    })),
    FIELD_LABELS,
  );

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
        monthlyPlCsvFileName(yearMonth),
      )}`,
      "cache-control": "no-store",
    },
  });
}
