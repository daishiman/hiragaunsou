import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { resolveSourceTypeFromContent } from "../../../../src/infrastructure/parsers/detectFileType";
import { detectYearMonth } from "../../../../src/infrastructure/parsers/detectYearMonth";
import { findImportSource } from "../../../../src/domain/rules/importSources";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/** 監査ファイル1件あたりの上限(20MB)。取込本体と同じ値。 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * 取込前の下読み。「このファイルは何年何月分か」「どの帳票か」を**中身だけ**から答える。
 *
 * ファイル名には年月が入っていないことがあり(給与集計表・運行実績表)、入っていても
 * 月替わりで書き換えられる。黙って誤った月に取り込むのが最悪の事故なので、取込を確定する前に
 * 判定結果と根拠を画面に出し、違えば利用者が直せるようにする。ここでは保存を一切行わない。
 */
export async function POST(request: Request) {
  const session = await getServerSession();
  if (!checkAccess(session, "input")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file が必要です" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "ファイルサイズが上限(20MB)を超えています" }, { status: 413 });
  }

  const content = await file.arrayBuffer();
  try {
    const sourceType = resolveSourceTypeFromContent(file.name, content);
    const detection = detectYearMonth(content);
    return NextResponse.json({
      sourceType,
      sourceLabel: sourceType === "unknown" ? null : (findImportSource(sourceType)?.label ?? null),
      ...detection,
    });
  } catch (e) {
    // 下読みに失敗しても取込を止めない。年月は利用者に選んでもらい、
    // 中身の不備は取込本体のエラー処理で原因つきで返す。
    console.error("detect failed", { fileName: file.name, error: e });
    return NextResponse.json({
      sourceType: "unknown",
      sourceLabel: null,
      yearMonth: null,
      basis: "ファイルの中身を読み取れませんでした。何年何月分として取り込むかを選んでください。",
      candidates: [],
    });
  }
}
