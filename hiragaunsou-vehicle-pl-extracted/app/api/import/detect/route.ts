import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1FileImportLogRepository } from "../../../../src/infrastructure/db/D1FileImportLogRepository";
import { resolveSourceTypeFromContent } from "../../../../src/infrastructure/parsers/detectFileType";
import { detectYearMonth, isXlsx } from "../../../../src/infrastructure/parsers/detectYearMonth";
import { findMissingColumns } from "../../../../src/infrastructure/parsers/requiredHeaders";
import { computeContentHash } from "../../../../src/infrastructure/parsers/contentHash";
import { parseCsv } from "../../../../src/infrastructure/parsers/csvUtils";
import { decodeCp932 } from "../../../../src/infrastructure/parsers/encoding";
import { findImportSource } from "../../../../src/domain/rules/importSources";
import {
  acceptedSourceTypesFor,
  evaluateFileImport,
  expectedLabelFor,
  type FileImportVerdict,
  type ImportScreen,
} from "../../../../src/domain/rules/fileImportCheck";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

/** 監査ファイル1件あたりの上限(20MB)。取込本体と同じ値。 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const SCREENS: ImportScreen[] = ["import", "vehicle_master", "driver_master"];

/**
 * 取込前の下読み。「何の帳票か」「何年何月分か」「必要な列が揃っているか」
 * 「前に取り込んでいないか」を**中身だけ**から答える。保存は一切行わない。
 *
 * ファイル名には年月が入っていないことがあり(給与集計表・運行実績表)、入っていても
 * 月替わりで書き換えられる。黙って誤った月・別の帳票を取り込むのが最悪の事故なので、
 * 取込を確定する前に判定結果と根拠を画面に出し、違えば利用者が直せるようにする。
 * 判定と文言のルールは docs/product/file-import-common-spec.md に一本化している。
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

  const screen = toScreen(form.get("screen"));
  const expectedSourceType = toStringOrNull(form.get("expectedSourceType"));
  const expectedYearMonth = toStringOrNull(form.get("expectedYearMonth"));

  const content = await file.arrayBuffer();
  const contentHash = await computeContentHash(content);

  try {
    const sourceType = resolveSourceTypeFromContent(file.name, content);
    const detection = detectYearMonth(content);
    const rowCount = countRows(content);
    const accepted = acceptedSourceTypesFor(screen, expectedSourceType);
    // 種類が違えば列不足はその症状にすぎないので、受け付ける種類だったときだけ列を見る。
    const missingColumns = accepted.includes(sourceType)
      ? findMissingColumns(columnTarget(screen, expectedSourceType), content)
      : [];

    const duplicate = await new D1FileImportLogRepository(createDb(env.DB)).findDuplicate({
      screen,
      contentHash,
      fileName: file.name,
    });

    const verdict = evaluateFileImport({
      screen,
      acceptedSourceTypes: accepted,
      expectedLabel: expectedLabelFor(screen, expectedSourceType),
      detectedSourceType: sourceType,
      expectedYearMonth,
      detectedYearMonth: detection.yearMonth,
      yearMonthBasis: detection.basis,
      yearMonthCandidates: detection.candidates,
      missingColumns,
      rowCount,
      duplicate,
    });

    return NextResponse.json({
      sourceType,
      sourceLabel: sourceType === "unknown" ? null : (findImportSource(sourceType)?.label ?? null),
      contentHash,
      rowCount,
      ...detection,
      verdict,
    });
  } catch (e) {
    // 下読みに失敗しても取込を止めない。年月は利用者に選んでもらい、
    // 中身の不備は取込本体のエラー処理で原因つきで返す。
    console.error("detect failed", { fileName: file.name, error: e });
    const basis = "ファイルの中身を読み取れませんでした。何年何月分として取り込むかを選んでください。";
    const verdict: FileImportVerdict = {
      summary: "中身を読み取れませんでした",
      basis,
      status: expectedYearMonth ? "confirm" : "ok",
      issues: [],
      confirmLabel: expectedYearMonth ? "この内容で取り込む" : null,
      needsYearMonthChoice: Boolean(expectedYearMonth),
      suggestedYearMonth: expectedYearMonth,
    };
    return NextResponse.json({
      sourceType: "unknown",
      sourceLabel: null,
      contentHash,
      rowCount: null,
      yearMonth: null,
      basis,
      candidates: [],
      verdict,
    });
  }
}

function toScreen(value: FormDataEntryValue | null): ImportScreen {
  return typeof value === "string" && (SCREENS as string[]).includes(value)
    ? (value as ImportScreen)
    : "import";
}

function toStringOrNull(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** マスタ画面はCSV経路の必須列がマスタ側にあるため、帳票種別ではなく画面で引く。 */
function columnTarget(screen: ImportScreen, expectedSourceType: string | null): string {
  return screen === "import" ? (expectedSourceType ?? "") : screen;
}

/** CSVの明細件数。Excelはシート構成が帳票ごとに違うため数えない(null)。 */
function countRows(content: ArrayBuffer): number | null {
  if (isXlsx(content)) return null;
  try {
    const rows = parseCsv(decodeCp932(content));
    return Math.max(0, rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== "")).length);
  } catch {
    return null;
  }
}
