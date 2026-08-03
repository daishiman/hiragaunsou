import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getServerSession } from "../../../../src/infrastructure/auth/session";
import { checkAccess } from "../../../../src/infrastructure/auth/accessControl";
import { createDb } from "../../../../src/infrastructure/db/client";
import { D1ImportBatchRepository } from "../../../../src/infrastructure/db/D1ImportBatchRepository";
import { R2FileStorageRepository } from "../../../../src/infrastructure/storage/R2FileStorageRepository";
import { ImportVehicleOperationUseCase } from "../../../../src/usecase/steps/importVehicleOperation";
import { ImportSalesMonitorUseCase } from "../../../../src/usecase/steps/importSalesMonitor";
import { ImportPayrollUseCase } from "../../../../src/usecase/steps/importPayroll";
import {
  ImportMonthlyPlWorkbookUseCase,
  MONTHLY_PL_WORKBOOK_SOURCE_TYPE,
} from "../../../../src/usecase/steps/importMonthlyPlWorkbook";
import { D1VehiclePlRepository } from "../../../../src/infrastructure/db/D1VehiclePlRepository";
import { detectFileType } from "../../../../src/infrastructure/parsers/detectFileType";
import { decodeCp932 } from "../../../../src/infrastructure/parsers/encoding";
import { parseCsv } from "../../../../src/infrastructure/parsers/csvUtils";
import { isSameOriginRequest } from "../../../_lib/assertSameOrigin";

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

/** CSVは列見出し、Excelは収支表シート構造で判定する。ファイル名だけには依存しない。 */
function resolveSourceType(fileName: string, content: ArrayBuffer): Exclude<SourceType, "auto"> | "unknown" {
  const bytes = new Uint8Array(content);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return MONTHLY_PL_WORKBOOK_SOURCE_TYPE;
  const rows = parseCsv(decodeCp932(content));
  return detectFileType(fileName, rows[0] ?? []);
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
    return NextResponse.json({ error: `unknown sourceType: ${sourceType}` }, { status: 400 });
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
  const resolvedSourceType = sourceType === "auto" ? resolveSourceType(file.name, content) : sourceType;
  if (resolvedSourceType === "unknown") {
    return NextResponse.json(
      { error: "ファイル内容から種別を判定できませんでした。CSVの列見出しまたは完成済みの収支表Excelを確認してください。" },
      { status: 422 },
    );
  }

  try {
    if (resolvedSourceType === "vehicle_operation") {
      const result = await new ImportVehicleOperationUseCase(fileStorage, importBatchRepo).execute(input);
      return NextResponse.json({ sourceType: resolvedSourceType, ...result });
    }
    if (resolvedSourceType === "sales_monitor") {
      const result = await new ImportSalesMonitorUseCase(fileStorage, importBatchRepo).execute(input);
      return NextResponse.json({ sourceType: resolvedSourceType, ...result });
    }
    if (resolvedSourceType === "payroll") {
      const result = await new ImportPayrollUseCase(fileStorage, importBatchRepo).execute(input);
      return NextResponse.json({ sourceType: resolvedSourceType, ...result });
    }
    const result = await new ImportMonthlyPlWorkbookUseCase(
      fileStorage,
      importBatchRepo,
      new D1VehiclePlRepository(db),
    ).execute(input);
    return NextResponse.json({ sourceType: resolvedSourceType, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "取込に失敗しました";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
