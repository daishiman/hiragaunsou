import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../../src/infrastructure/db/D1ImportBatchRepository";
import { D1FileImportLogRepository } from "../../../../src/infrastructure/db/D1FileImportLogRepository";
import { computeContentHash } from "../../../../src/infrastructure/parsers/contentHash";
import { R2FileStorageRepository } from "../../../../src/infrastructure/storage/R2FileStorageRepository";
import { ImportVehicleOperationUseCase } from "../../../../src/usecase/steps/importVehicleOperation";
import { ImportSalesMonitorUseCase } from "../../../../src/usecase/steps/importSalesMonitor";
import { ImportPayrollUseCase } from "../../../../src/usecase/steps/importPayroll";
import {
  ImportMonthlyPlWorkbookUseCase,
  MONTHLY_PL_WORKBOOK_SOURCE_TYPE,
} from "../../../../src/usecase/steps/importMonthlyPlWorkbook";
import { resolveSourceTypeFromContent } from "../../../../src/infrastructure/parsers/detectFileType";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";
import { rebuildMonthlyPlAfterImport } from "../../../_lib/monthlyPlRecalculator";
import { findImportSource } from "../../../../src/domain/rules/importSources";
import { parseSalesMonitorCsv, detectDominantYearMonth } from "../../../../src/infrastructure/parsers/salesMonitorParser";

const SOURCE_TYPES = [
  "auto",
  "vehicle_operation",
  "sales_monitor",
  "payroll",
  MONTHLY_PL_WORKBOOK_SOURCE_TYPE,
] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

/** 監査ファイル1件あたりの上限(20MB)。実データのCSV/Excelは数百KB〜数MB程度のため十分な余裕。 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function isSourceType(value: string): value is SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

function isYearMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** F3/F4/F5 データ取込。Presentation層はUseCase呼び出しのみ、パース・保存ロジックは持たない。 */
export async function POST(request: Request, { params }: { params: Promise<{ sourceType: string }> }) {
  const session = await getServerSession();
  if (!checkAccess(session, "input")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { env } = await getCloudflareContext({ async: true });
  if (!isSameOriginRequest(request, env.BETTER_AUTH_URL)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { sourceType } = await params;
  if (!isSourceType(sourceType)) {
    return NextResponse.json({ error: "指定された帳票の種類は取り込めません" }, { status: 400 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const yearMonth = form.get("yearMonth");
  if (!(file instanceof File) || typeof yearMonth !== "string" || !isYearMonth(yearMonth)) {
    return NextResponse.json({ error: "file and yearMonth（YYYY-MM）が必要です" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "ファイルサイズが上限(20MB)を超えています" }, { status: 413 });
  }

  const db = createDb(env.DB);
  const fileStorage = new R2FileStorageRepository(env.IMPORTS_BUCKET);
  const importBatchRepo = new D1ImportBatchRepository(db);
  const content = await file.arrayBuffer();
  const input = { yearMonth, fileName: file.name, content, importedBy: session!.id };

  let detected: Exclude<SourceType, "auto"> | "unknown";
  try {
    detected = resolveSourceTypeFromContent(file.name, content) as
      | Exclude<SourceType, "auto">
      | "unknown";
  } catch (e) {
    // 種別判定(見出し行の読み取り)自体が想定外に失敗した場合も、フレームワークの
    // 汎用エラーページに落とさず、原因を特定できるメッセージをJSONで返す。
    console.error("resolveSourceType failed", { fileName: file.name, error: e });
    return NextResponse.json({ error: toImportErrorMessage(e) }, { status: 422 });
  }
  const resolvedSourceType = sourceType === "auto" ? detected : sourceType;
  if (resolvedSourceType === "unknown") {
    return NextResponse.json(
      { error: "ファイル内容から種別を判定できませんでした。CSVの列見出しまたは完成済みの収支表Excelを確認してください。" },
      { status: 422 },
    );
  }
  // STEP別の投入口から来た場合、自動判定は「判定」ではなく「取り違え検知」として使う。
  // 投入口が決まっているので、別帳票を入れた瞬間に弾ける(無関係ファイルの誤投入がここで止まる)。
  if (sourceType !== "auto" && detected !== "unknown" && detected !== resolvedSourceType) {
    const expected = findImportSource(resolvedSourceType)?.label ?? "判別できない帳票";
    const actual = findImportSource(detected)?.label ?? "判別できない帳票";
    return NextResponse.json(
      { error: `この欄は「${expected}」用です。選択されたファイルは「${actual}」と判定されました。` },
      { status: 422 },
    );
  }

  // 対象年月チェック。売上モニタリストは伝票ごとに積荷日を持つため、
  // 「選んだ年月」と「ファイルの中身が実際にどの年月の伝票か」を多数決で突き合わせ、
  // 前月分ファイルの取り違え等に取込を確定する前に気づけるようにする。
  // 他の帳票(運行実績・給与集計表)は月内に日付列を持たないため判定できず、対象外。
  if (resolvedSourceType === "sales_monitor" && form.get("confirmYearMonth") !== "true") {
    let mismatch: ReturnType<typeof detectDominantYearMonth> | null = null;
    try {
      mismatch = detectDominantYearMonth(parseSalesMonitorCsv(content));
    } catch {
      mismatch = null; // ここでの判定に失敗しても、取込本体の解析・エラー処理に委ねる
    }
    if (mismatch?.dominantYearMonth && mismatch.dominantYearMonth !== yearMonth) {
      return NextResponse.json(
        {
          error: "yearMonthMismatch",
          yearMonthMismatch: {
            sourceType: resolvedSourceType,
            selectedYearMonth: yearMonth,
            detectedYearMonth: mismatch.dominantYearMonth,
            matchedRows: mismatch.matchedRows,
            dominantCount: mismatch.dominantCount,
          },
        },
        { status: 409 },
      );
    }
  }

  // 入れ直し判定。運行実績は3営業所分が別ファイルで正常に共存するため同名ファイルだけを、
  // それ以外は月1ファイルなのでその月の取込全体を、置き換え対象とする。
  const batches = await importBatchRepo.findBatches(yearMonth, resolvedSourceType);
  const superseded = findImportSource(resolvedSourceType)?.multiFile
    ? batches.filter((batch) => batch.fileName === file.name)
    : batches;

  if (superseded.length > 0 && form.get("replace") !== "true") {
    return NextResponse.json(
      {
        error: "conflict",
        conflict: {
          sourceType: resolvedSourceType,
          sameFileName: superseded.some((batch) => batch.fileName === file.name),
          superseded: superseded.map((batch) => ({
            fileName: batch.fileName,
            rowCount: batch.rowCount,
            importedAt: batch.importedAt,
          })),
        },
      },
      { status: 409 },
    );
  }

  try {
    if (superseded.length > 0) {
      await importBatchRepo.deleteBatches(
        yearMonth,
        resolvedSourceType,
        superseded.map((batch) => batch.id),
      );
    }
    // 帳票ごとに戻り値の形が違うので、記録と応答で共通に読める形に受ける。
    const result: { totalRows?: number } & object =
      resolvedSourceType === "vehicle_operation"
        ? await new ImportVehicleOperationUseCase(fileStorage, importBatchRepo).execute(input)
        : resolvedSourceType === "sales_monitor"
          ? await new ImportSalesMonitorUseCase(fileStorage, importBatchRepo).execute(input)
          : resolvedSourceType === "payroll"
            ? await new ImportPayrollUseCase(fileStorage, importBatchRepo).execute(input)
            : // 完成済みExcelは答え合わせの相手として保管するだけ。収支表はCSVと手入力から作る。
              // ここに車両マスタや手入力への書き込みを足すと、CSVが1本も通っていなくても表が
              // 完成してしまう(実際に本番の2026年5月データがそうなっていた)ので足さないこと。
              await new ImportMonthlyPlWorkbookUseCase(fileStorage, importBatchRepo).execute({
                ...input,
                importedByName: session!.name,
              });

    // 取込の記録を残す。次に同じファイルが選ばれたときの照合に使う
    // (docs/product/file-import-common-spec.md §5)。
    // 記録に失敗しても取込自体は成功しているので、画面には失敗を出さない。
    try {
      const sentHash = form.get("contentHash");
      await new D1FileImportLogRepository(db).record({
        screen: "import",
        sourceType: resolvedSourceType,
        yearMonth,
        fileName: file.name,
        contentHash:
          typeof sentHash === "string" && sentHash !== "" ? sentHash : await computeContentHash(content),
        rowCount: typeof result.totalRows === "number" ? result.totalRows : 0,
        importedBy: session!.id,
        importedByName: session!.name,
      });
    } catch (e) {
      console.error("file import log failed", { fileName: file.name, error: e });
    }

    // 取り込んだ内容を、そのまま他の画面(手入力の自動計算値・月次収支表・年間集計・ホームの進捗)へ
    // 通す。ここで下地を作らないと、4つとも取り込み終えても全画面が空のままになる。
    // 答え合わせ用Excelは収支表の材料ではないので対象外。
    const plRebuild =
      resolvedSourceType === MONTHLY_PL_WORKBOOK_SOURCE_TYPE
        ? null
        : await rebuildMonthlyPlAfterImport(db, yearMonth);

    return NextResponse.json({ sourceType: resolvedSourceType, ...result, plRebuild });
  } catch (e) {
    console.error("import failed", { sourceType: resolvedSourceType, fileName: file.name, error: e });
    return NextResponse.json({ error: toImportErrorMessage(e) }, { status: 422 });
  }
}

/**
 * DrizzleはD1の失敗を「Failed query: ... params: ...」に包み替え、実際の原因(cause)を
 * メッセージに含めない。原因が分からないSQLダンプだけが画面に出ると調査できないため、
 * cause を連結し、巨大なパラメータダンプは画面に出さない。詳細はサーバログ側に残す。
 */
function toImportErrorMessage(e: unknown): string {
  if (!(e instanceof Error)) return "取込に失敗しました";
  const cause = e.cause instanceof Error ? e.cause.message : typeof e.cause === "string" ? e.cause : null;
  const head = e.message.split("\nparams:")[0]!.slice(0, 500);

  // D1の1日あたり書き込み行数の上限に当たった場合、SQLダンプだけを見せても
  // 「壊れた」としか読めない。過去分をまとめて取り込むときに実際に起こりうるため、
  // 何が起きていて何をすればよいかを画面に出す。
  if (/daily limit|exceeded your.*limit|too many (writes|rows)/i.test(`${cause ?? ""} ${head}`)) {
    return "本日のデータベース書き込み上限に達しました。取り込んだ内容は反映されていません。日付が変わってから、または過去分は1日あたり数か月ずつに分けて取り込んでください。";
  }
  return cause ? `${cause}（${head}）` : head;
}
