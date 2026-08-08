import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1DriverMasterRepository } from "../../../../src/infrastructure/db/D1MasterRepository";
import { parseDriverMasterCsv } from "../../../../src/infrastructure/parsers/driverMasterParser";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/** 運転者マスタCSV1件あたりの上限(5MB)。百名規模の一覧なので実データは数KB程度。 */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * 運転者マスタ管理 (/admin/driver-master 画面のバックエンド、manage_imports 権限=admin専用)。
 *
 * GET: 現在のマスタ一覧。POST: CSVの解析結果(プレビュー)のみを返し、DBには書き込まない。
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
    return NextResponse.json({ error: "ファイルサイズが上限(5MB)を超えています" }, { status: 413 });
  }

  try {
    const { valid, errors } = parseDriverMasterCsv(await file.arrayBuffer());
    return NextResponse.json({ fileName: file.name, valid, errors });
  } catch (e) {
    const message = e instanceof Error ? e.message : "CSVの解析に失敗しました";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
