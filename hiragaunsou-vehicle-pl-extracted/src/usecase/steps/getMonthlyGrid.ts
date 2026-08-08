import { VEHICLE_PL_FIELDS, type VehiclePlField } from "../../domain/entities/VehiclePl";
import { formatVehicleNoLabel } from "../../domain/rules/towedVehicle";
import type { AnomalyFlag } from "../../domain/rules/anomalyDetection";
import {
  anomalyIssues,
  excelMismatchIssues,
  heaviestSeverity,
  overrideIssues,
  unlinkedTrailerIssues,
  reviewMonthlyPl,
  type ReviewSeverity,
  type VehiclePlIssue,
} from "../../domain/rules/vehiclePlReview";
import type {
  VehiclePlOverrideRecord,
  VehiclePlOverrideRepository,
} from "../../domain/repositories/VehiclePlOverrideRepository";
import type { ExcelReconcileResult } from "../../domain/rules/excelReconciliation";
import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { ReviewFlagRepository } from "../../domain/repositories/VehiclePlRepository";

/**
 * F1 月次収支グリッド ユースケース (S2画面)。
 * UseCase層: リポジトリインターフェース越しにのみ外部接続する。DBの具体実装は知らない。
 */
export interface GridRow {
  vehicleNo: string;
  /**
   * 表に出す車番の見た目。トレーラを吸収した行は「129/1113」になる。
   * vehicleNo(トラクタの車番)は詳細画面や上書きのキーとしてそのまま使うので、別に持つ。
   */
  vehicleNoLabel: string;
  values: Record<VehiclePlField, number | string | null>;
  /** 異常値セルのハイライト対象フィールド一覧 */
  highlightedFields: string[];
  /** 確認してほしい箇所と、その判断材料 */
  issues: VehiclePlIssue[];
  /** 行の代表色を決めるための、その行で最も重い所見 */
  severity: ReviewSeverity | null;
}

export interface GridReviewSummary {
  blocking: number;
  warning: number;
  info: number;
  /** 1件も所見が無い車両の台数 (=そのまま確定してよい台数) */
  cleanVehicles: number;
}

export interface GridResponse {
  yearMonth: string;
  fields: readonly VehiclePlField[];
  rows: GridRow[];
  isEmpty: boolean;
  review: GridReviewSummary;
}

export function buildGridResponse(
  yearMonth: string,
  plRows: Array<Record<string, unknown> & { vehicleNo: string }>,
  anomalyFlags: AnomalyFlag[],
  reconciliation?: Pick<ExcelReconcileResult, "vehicles">,
  overrides: readonly VehiclePlOverrideRecord[] = [],
): GridResponse {
  const flagsByVehicle = new Map<string, Set<string>>();
  for (const flag of anomalyFlags) {
    const set = flagsByVehicle.get(flag.vehicleNo) ?? new Set<string>();
    set.add(flag.field);
    flagsByVehicle.set(flag.vehicleNo, set);
  }

  // 所見は3つの出どころを1つの形に揃えて持つ。UIが出どころごとの分岐を持たずに済み、
  // 「印の付いたセルを見る」という1つの操作にまとまる。
  const allIssues = [
    ...reviewMonthlyPl(
      plRows.map((row) => ({ ...row, no: row.vehicleNo })),
      yearMonth,
    ),
    ...anomalyIssues(anomalyFlags, yearMonth),
    ...(reconciliation ? excelMismatchIssues(reconciliation, yearMonth) : []),
    ...overrideIssues(
      overrides,
      new Map(plRows.map((row) => [row.vehicleNo, row])),
      yearMonth,
    ),
    // 収支表に単独の行として残っているトレーラ。けん引先を登録すれば消える
    // (統合された行は finalize が消しているので、ここに現れること自体が未登録の印)。
    ...unlinkedTrailerIssues(
      plRows.map((row) => ({
        vehicleNo: row.vehicleNo,
        type: row.type as string | null | undefined,
        sales: row.sales as number | null | undefined,
        expense: row.expense as number | null | undefined,
      })),
      yearMonth,
    ),
  ];
  const issuesByVehicle = new Map<string, VehiclePlIssue[]>();
  for (const issue of allIssues) {
    const list = issuesByVehicle.get(issue.vehicleNo) ?? [];
    list.push(issue);
    issuesByVehicle.set(issue.vehicleNo, list);
  }

  const rows: GridRow[] = plRows.map((row) => {
    const values = {} as Record<VehiclePlField, number | string | null>;
    for (const field of VEHICLE_PL_FIELDS) {
      values[field] = (row[field] as number | string | null) ?? null;
    }
    const issues = issuesByVehicle.get(row.vehicleNo) ?? [];
    const vehicleNoLabel = formatVehicleNoLabel(
      row.vehicleNo,
      (row.towedVehicleNos as readonly string[] | string | undefined) ?? [],
    );
    // CSV出力は values をそのまま並べる。ここを車番のままにすると、
    // 書き出したCSVと現行Excelの最終成果物で車番の見え方だけがずれる。
    values.no = vehicleNoLabel;

    return {
      vehicleNo: row.vehicleNo,
      vehicleNoLabel,
      values,
      highlightedFields: Array.from(flagsByVehicle.get(row.vehicleNo) ?? []),
      issues,
      severity: heaviestSeverity(issues),
    };
  });

  const review: GridReviewSummary = {
    blocking: allIssues.filter((i) => i.severity === "blocking").length,
    warning: allIssues.filter((i) => i.severity === "warning").length,
    info: allIssues.filter((i) => i.severity === "info").length,
    cleanVehicles: rows.filter((r) => r.issues.length === 0).length,
  };

  return {
    yearMonth,
    fields: VEHICLE_PL_FIELDS,
    rows,
    isEmpty: rows.length === 0,
    review,
  };
}

export class GetMonthlyGridUseCase {
  constructor(
    private readonly vehiclePlRepo: VehiclePlRepository,
    private readonly reviewFlagRepo: ReviewFlagRepository,
    /** 人が直した行に印を付けるために読む。無くても表は作れるので任意。 */
    private readonly overrideRepo?: VehiclePlOverrideRepository,
  ) {}

  async execute(
    yearMonth: string,
    reconciliation?: Pick<ExcelReconcileResult, "vehicles">,
  ): Promise<GridResponse> {
    const plRows = await this.vehiclePlRepo.findByYearMonth(yearMonth);
    const overrides = (await this.overrideRepo?.findByYearMonth(yearMonth)) ?? [];
    const openFlags = await this.reviewFlagRepo.findOpenByYearMonth(yearMonth);
    const anomalyFlags: AnomalyFlag[] = openFlags
      .filter((f) => f.vehicleNo && f.field)
      .map((f) => ({
        vehicleNo: f.vehicleNo as string,
        field: f.field as string,
        type: f.type as AnomalyFlag["type"],
        message: f.message,
        monthlyReference: null,
        value: null,
      }));
    return buildGridResponse(
      yearMonth,
      plRows.map((r) => ({ ...r, vehicleNo: r.no as string })),
      anomalyFlags,
      reconciliation,
      overrides,
    );
  }
}
