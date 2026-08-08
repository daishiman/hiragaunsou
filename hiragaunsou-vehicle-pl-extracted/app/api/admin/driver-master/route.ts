import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1DriverMasterRepository } from "../../../../src/infrastructure/db/D1MasterRepository";
import { parseDriverMasterFile } from "../../../../src/infrastructure/parsers/driverMasterParser";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/**
 * 1件あたりの上限(20MB)。CSVなら数KBだが、社内Excel「★車両別収支計算用」を
 * そのまま受け付けるため車両マスタ・月次収支表の取込と同じ上限に揃える。
 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * 運転者マスタ管理 (/admin/driver-master 画面のバックエンド、manage_imports 権限=admin専用)。
 *
 * GET: 現在のマスタ一覧。POST: Excel/CSVの解析結果(プレビュー)のみを返し、DBには書き込まない。
 * 確定は confirm/route.ts に分ける。社員コード↔車番の対応は人件費が乗る先そのものなので、
 * 車両マスタと同じく「何が新規で何が更新か」を人が見てから確定できる二段構えにする。
 */
export async function GET() {
  const session = await getServerSession();
  if (!checkAccess(session, "manage_imports")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const drivers = await new D1DriverMasterRepository(createDb(env.DB)).findAll();
  return NextResponse.json({ drivers });
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
  // 運転者名・社員Noを見るかを決めるために使う (車両マスタと同じ)。
  const yearMonth = form.get("yearMonth");
  const preferredYearMonth = typeof yearMonth === "string" && yearMonth !== "" ? yearMonth : undefined;

  try {
    const { valid, errors, source } = parseDriverMasterFile(
      await file.arrayBuffer(),
      preferredYearMonth,
    );
    return NextResponse.json({ fileName: file.name, valid, errors, source });
  } catch (e) {
    const message = e instanceof Error ? e.message : "ファイルの解析に失敗しました";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
