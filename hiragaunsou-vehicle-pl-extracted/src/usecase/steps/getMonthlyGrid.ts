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
} from "../../domain/rules/vehiclePlReview";
import type {
  VehiclePlOverrideRecord,
  VehiclePlOverrideRepository,
} from "../../domain/repositories/VehiclePlOverrideRepository";
import type { PlIssueAckRepository } from "../../domain/repositories/PlIssueAckRepository";
import {
  applyIssueAcks,
  openIssues,
  type PlIssueAckRecord,
  type ReviewedIssue,
} from "../../domain/rules/plIssueAck";
import type { OverridableField } from "../../domain/rules/vehiclePlOverride";
import type { ExcelReconcileResult } from "../../domain/rules/excelReconciliation";
import type { VehiclePlRepository } from "../../domain/repositories/VehiclePlRepository";
import type { ReviewFlagRepository } from "../../domain/repositories/VehiclePlRepository";

/**
 * F1 月次収支グリッド ユースケース (S2画面)。
 * UseCase層: リポジトリインターフェース越しにのみ外部接続する。DBの具体実装は知らない。
 */
/** その車両に保存されている「人が直した値」。画面の編集欄の初期値と競合検知に使う。 */
export interface GridOverride {
  values: Partial<Record<OverridableField, number>>;
  excluded: boolean;
  reason: string;
  /** 最終更新時刻 (ミリ秒)。保存時にそのまま送り返して、先に直した人の内容を消さない */
  updatedAt: number;
  updatedByName: string | null;
  /** まだ収支表に反映していない (この行の数字は直す前のもの) */
  pending: boolean;
}

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
  /** 確認してほしい箇所と、その判断材料 (確認済みの印を重ねたもの) */
  issues: ReviewedIssue[];
  /**
   * 行の代表色を決めるための、その行で最も重い所見。
   * 確認済みの指摘は数えない (確認が済んだ行を赤いままにすると、残りが見えなくなる)。
   */
  severity: ReviewSeverity | null;
  /** 人が直した値。無ければ null */
  override: GridOverride | null;
}

export interface GridReviewSummary {
  /** 以下3つは「まだ確認していない」指摘の件数 */
  blocking: number;
  warning: number;
  info: number;
  /** 確認済みにした指摘の件数 (進捗表示に使う) */
  acknowledged: number;
  /** 1件も所見が無い車両の台数 (=そのまま確定してよい台数) */
  cleanVehicles: number;
  /** まだ収支表に反映していない直しの件数 */
  pendingOverrides: number;
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
  acks: readonly PlIssueAckRecord[] = [],
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
  // 確認済みの印をここで1度だけ重ねる。以降 (行の色・件数・画面) はすべて
  // 「確認済みかどうか」を見て動くので、判定が散らばらないようにする。
  const reviewedIssues = applyIssueAcks(allIssues, acks);
  const issuesByVehicle = new Map<string, ReviewedIssue[]>();
  for (const issue of reviewedIssues) {
    const list = issuesByVehicle.get(issue.vehicleNo) ?? [];
    list.push(issue);
    issuesByVehicle.set(issue.vehicleNo, list);
  }

  const overrideByVehicle = new Map(overrides.map((o) => [o.vehicleNo, o]));

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

    const override = overrideByVehicle.get(row.vehicleNo);

    return {
      vehicleNo: row.vehicleNo,
      vehicleNoLabel,
      values,
      highlightedFields: Array.from(flagsByVehicle.get(row.vehicleNo) ?? []),
      issues,
      severity: heaviestSeverity(openIssues(issues)),
      override: override
        ? {
            values: override.values,
            excluded: override.excluded,
            reason: override.reason,
            updatedAt: override.updatedAt.getTime(),
            updatedByName: override.updatedByName,
            pending: override.appliedAt === null,
          }
        : null,
    };
  });

  const open = openIssues(reviewedIssues);
  const review: GridReviewSummary = {
    blocking: open.filter((i) => i.severity === "blocking").length,
    warning: open.filter((i) => i.severity === "warning").length,
    info: open.filter((i) => i.severity === "info").length,
    acknowledged: reviewedIssues.length - open.length,
    cleanVehicles: rows.filter((r) => r.issues.length === 0).length,
    pendingOverrides: overrides.filter((o) => o.appliedAt === null).length,
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
    /** 「確認済み」にした指摘を落とすために読む。無くても表は作れるので任意。 */
    private readonly ackRepo?: PlIssueAckRepository,
  ) {}

  async execute(
    yearMonth: string,
    reconciliation?: Pick<ExcelReconcileResult, "vehicles">,
  ): Promise<GridResponse> {
    const plRows = await this.vehiclePlRepo.findByYearMonth(yearMonth);
    const overrides = (await this.overrideRepo?.findByYearMonth(yearMonth)) ?? [];
    const acks = (await this.ackRepo?.findByYearMonth(yearMonth)) ?? [];
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
      acks,
    );
  }
}
