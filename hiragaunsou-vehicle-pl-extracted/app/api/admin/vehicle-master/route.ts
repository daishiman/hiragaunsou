import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1VehicleMasterRepository } from "../../../../src/infrastructure/db/D1MasterRepository";
import { parseVehicleMasterFile } from "../../../../src/infrastructure/parsers/vehicleMasterParser";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * 1件あたりの上限(20MB)。CSVなら数KBだが、社内Excel「★車両別収支計算用」を
 * そのまま受け付けるため月次収支表の取込 (/api/import) と同じ上限に揃える
 * (実データは1.3MB、年度ブックはこれより大きい)。
 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * 車両マスタ管理 (/admin/vehicle-master 画面のバックエンド、manage_imports 権限=admin専用)。
 *
 * GET: 現在のマスタ一覧。POST: CSVの解析結果(プレビュー)のみを返し、DBには書き込まない。
 * 確定は confirm/route.ts に分ける。保険・税・リース料は全車両の原価に効くため、
 * 「何が新規で何が更新か」を人が見てから確定できる二段構えにしている。
 */
export async function GET() {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_imports")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const vehicles = await new D1VehicleMasterRepository(createDb(env.DB)).findAllActive();
  return NextResponse.json({ vehicles });
}

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_imports")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "fileが必要です" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "ファイルサイズが上限(20MB)を超えています" }, { status: 413 });
  }

  // 対象年月は任意。年度ブック(12か月分のシート)を渡されたときに、どのシートの
  // 保険・税・リース料をマスタとするかを決めるために使う。
  const yearMonth = form.get("yearMonth");
  const preferredYearMonth = typeof yearMonth === "string" && yearMonth !== "" ? yearMonth : undefined;

  try {
    const { valid, errors } = parseVehicleMasterFile(await file.arrayBuffer(), preferredYearMonth);
    return NextResponse.json({ fileName: file.name, valid, errors });
  } catch (e) {
    const message = e instanceof Error ? e.message : "ファイルの解析に失敗しました";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
