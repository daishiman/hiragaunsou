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
import {
  EDIT_TARGET_FIELD,
  type ValueBenchmark,
} from "../../domain/rules/plIssueGuidance";
import { monthLabel, trailingYearMonths } from "../../domain/rules/fiscalPeriod";
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
  /**
   * 指摘の付いた項目ごとの「ふつうはこのくらい」。
   *
   * 仕様を知らない人が値の妥当性を判断するには、比べる相手が要る。
   * 表の他の行を目で追わせる代わりに、同じ車種の中央値と先月の値をここに書き写す。
   * 指摘の無い項目には作らない (106行×全列だと送る量が増えるだけで使われない)。
   */
  benchmarks: Record<string, ValueBenchmark>;
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

/** 数字として比較できる値だけを取り出す (文字列の列・空欄・0は中央値の材料にしない)。 */
function sampleOf(row: Record<string, unknown>, field: string): number | null {
  const value = Number(row[field]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] as number) + upper) / 2;
}

/**
 * 「ふつうはこのくらい」を作る。
 *
 * 同じ車種で比べるのが本筋 (大型と小型では走行距離も給与も桁が違う) だが、
 * 車種の台数が少ないと中央値が1台の値に引きずられる。3台に満たない場合だけ
 * 全車両に広げ、どちらで出したかをラベルに書いて画面に出す (何と比べたのか隠さない)。
 */
const MIN_SAMPLES_PER_TYPE = 3;

function buildBenchmarkLookup(
  plRows: readonly (Record<string, unknown> & { vehicleNo: string })[],
  previousRows: readonly Record<string, unknown>[],
  previousLabel: string,
) {
  const byType = new Map<string, (Record<string, unknown> & { vehicleNo: string })[]>();
  for (const row of plRows) {
    const type = String(row.type ?? "");
    const list = byType.get(type) ?? [];
    list.push(row);
    byType.set(type, list);
  }
  const previousByVehicle = new Map(
    previousRows.map((row) => [String(row.no ?? row.vehicleNo ?? ""), row]),
  );
  const cache = new Map<string, number | null>();

  return (row: Record<string, unknown> & { vehicleNo: string }, field: string): ValueBenchmark => {
    const type = String(row.type ?? "");
    const cacheKey = `${type}::${field}`;
    let typical = cache.get(cacheKey);
    let typicalLabel = type === "" ? "全車両の中央値" : `${type}の中央値`;
    if (typical === undefined) {
      const sameType = (byType.get(type) ?? [])
        .map((r) => sampleOf(r, field))
        .filter((v): v is number => v !== null);
      typical = median(sameType);
      if (sameType.length < MIN_SAMPLES_PER_TYPE) typical = null;
      cache.set(cacheKey, typical);
    }
    if (typical === null) {
      const allKey = `*::${field}`;
      let all = cache.get(allKey);
      if (all === undefined) {
        all = median(
          plRows.map((r) => sampleOf(r, field)).filter((v): v is number => v !== null),
        );
        cache.set(allKey, all);
      }
      typical = all;
      typicalLabel = "全車両の中央値";
    }

    const prevRow = previousByVehicle.get(row.vehicleNo);
    const previous = prevRow ? Number(prevRow[field]) : NaN;

    return {
      typical,
      typicalLabel: typical === null ? "" : typicalLabel,
      previous: Number.isFinite(previous) ? previous : null,
      previousLabel: Number.isFinite(previous) ? previousLabel : "",
    };
  };
}

export function buildGridResponse(
  yearMonth: string,
  plRows: Array<Record<string, unknown> & { vehicleNo: string }>,
  anomalyFlags: AnomalyFlag[],
  reconciliation?: Pick<ExcelReconcileResult, "vehicles">,
  overrides: readonly VehiclePlOverrideRecord[] = [],
  acks: readonly PlIssueAckRecord[] = [],
  /** 先月の収支表。「先月はこうだった」を出すためだけに使う (無くても表は作れる)。 */
  previousRows: readonly Record<string, unknown>[] = [],
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
  const previousYearMonth = trailingYearMonths(yearMonth, 2)[0] ?? yearMonth;
  const benchmarkOf = buildBenchmarkLookup(
    plRows,
    previousRows,
    `先月(${monthLabel(previousYearMonth)})`,
  );

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

    const benchmarks: Record<string, ValueBenchmark> = {};
    for (const issue of issues) {
      // 指摘の項目と、その指摘を直す入口の項目 (運送収入→運賃 など) の両方に用意する。
      // 入口側の「ふつうはこのくらい」が無いと、入力欄に例も判定も出せない。
      for (const field of [issue.field, EDIT_TARGET_FIELD[issue.code]]) {
        if (field === undefined || benchmarks[field]) continue;
        const benchmark = benchmarkOf(row, field);
        // 中央値も先月の値も無い項目は、書き写しても判断材料にならない。
        if (benchmark.typical === null && benchmark.previous === null) continue;
        benchmarks[field] = benchmark;
      }
    }

    return {
      vehicleNo: row.vehicleNo,
      vehicleNoLabel,
      values,
      highlightedFields: Array.from(flagsByVehicle.get(row.vehicleNo) ?? []),
      issues,
      benchmarks,
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
    // 「先月はこうだった」を確認画面に出すためだけの読み込み。取れなくても表は成立するので、
    // 失敗しても表全体を落とさない (先月の収支表がまだ無い月が必ず存在する)。
    const previousRows = await this.vehiclePlRepo
      .findByYearMonth(trailingYearMonths(yearMonth, 2)[0] ?? yearMonth)
      .then((rows) => rows.map((row) => ({ ...row }) as Record<string, unknown>))
      .catch(() => [] as Record<string, unknown>[]);
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
      previousRows,
    );
  }
}
