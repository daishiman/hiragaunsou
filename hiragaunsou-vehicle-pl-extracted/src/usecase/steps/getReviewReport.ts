import type { GridResponse, GridRow } from "./getMonthlyGrid";
import type { ReviewedIssue } from "../../domain/rules/plIssueAck";
import type { OverridableField } from "../../domain/rules/vehiclePlOverride";

/**
 * 収支表の確認結果を1枚にまとめる (印刷・共有用)。
 *
 * 月次の確認作業は「誰が・いつ・何を見て・どう判断したか」が残らないと、
 * 翌月に同じ議論をやり直すことになる。判断そのものは pl_issue_ack と
 * vehicle_pl_override に残っているので、ここではそれを人が読める順に並べ替えるだけで、
 * 新しい事実は作らない (集計し直して数字が画面と食い違う、という事故を避ける)。
 *
 * UseCase層: 表示のための組み替えのみ。DBには触らない。
 */

/** 人が直した数字1台分 */
export interface ReviewReportFix {
  vehicleNo: string;
  vehicleNoLabel: string;
  excluded: boolean;
  reason: string;
  updatedByName: string | null;
  updatedAt: number;
  /** まだ収支表に反映していない (この直しは今の数字に入っていない) */
  pending: boolean;
  entries: { field: OverridableField; value: number }[];
}

/** 指摘1件に対する判断 */
export interface ReviewReportJudgement {
  vehicleNo: string;
  vehicleNoLabel: string;
  field: string;
  code: string;
  severity: ReviewedIssue["severity"];
  title: string;
  value: number | string | null;
  note: string | null;
  judgedByName: string | null;
  /** 判断した時刻 (ミリ秒)。まだ判断していない指摘は null */
  judgedAt: number | null;
}

export interface ReviewReport {
  yearMonth: string;
  /** この紙を出した時刻と人 (いつ時点の状況かが分からない紙は共有できない) */
  generatedAt: number;
  generatedByName: string;
  isConfirmed: boolean;
  fixes: ReviewReportFix[];
  /** 「このままでよい」と判断した指摘 */
  okItems: ReviewReportJudgement[];
  /** 「あとで見る」にしたまま残っている指摘 */
  postponedItems: ReviewReportJudgement[];
  /** まだ誰も判断していない指摘 */
  openItems: ReviewReportJudgement[];
  summary: {
    vehicles: number;
    /** 1件も指摘が無かった台数 */
    cleanVehicles: number;
    fixedVehicles: number;
    ok: number;
    postponed: number;
    open: number;
  };
}

/** 重い指摘から並べる (紙で上から読んだときに、重要な判断が先に来るように) */
const SEVERITY_ORDER = { blocking: 0, warning: 1, info: 2 } as const;

function toJudgement(row: GridRow, issue: ReviewedIssue): ReviewReportJudgement {
  return {
    vehicleNo: row.vehicleNo,
    vehicleNoLabel: row.vehicleNoLabel,
    field: issue.field,
    code: issue.code,
    severity: issue.severity,
    title: issue.title,
    value: issue.value,
    note: issue.ack?.note ?? null,
    judgedByName: issue.ack?.ackedByName ?? null,
    judgedAt: issue.ack?.ackedAt ?? null,
  };
}

function sortJudgements(items: ReviewReportJudgement[]): ReviewReportJudgement[] {
  return items.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.vehicleNo.localeCompare(b.vehicleNo, "ja"),
  );
}

export function buildReviewReport(
  grid: GridResponse,
  options: {
    /** 省略時は今。時刻の取得を画面(描画)の中に置かないため、既定値はここで入れる */
    generatedAt?: number;
    generatedByName: string;
    isConfirmed: boolean;
  },
): ReviewReport {
  const generatedAt = options.generatedAt ?? Date.now();
  const okItems: ReviewReportJudgement[] = [];
  const postponedItems: ReviewReportJudgement[] = [];
  const openItems: ReviewReportJudgement[] = [];
  const fixes: ReviewReportFix[] = [];

  for (const row of grid.rows) {
    for (const issue of row.issues) {
      const judgement = toJudgement(row, issue);
      if (issue.acknowledged) okItems.push(judgement);
      else if (issue.postponed) postponedItems.push(judgement);
      else openItems.push(judgement);
    }

    const override = row.override;
    if (!override) continue;
    fixes.push({
      vehicleNo: row.vehicleNo,
      vehicleNoLabel: row.vehicleNoLabel,
      excluded: override.excluded,
      reason: override.reason,
      updatedByName: override.updatedByName,
      updatedAt: override.updatedAt,
      pending: override.pending,
      entries: Object.entries(override.values)
        .filter((entry): entry is [OverridableField, number] => typeof entry[1] === "number")
        .map(([field, value]) => ({ field, value })),
    });
  }

  fixes.sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    yearMonth: grid.yearMonth,
    generatedAt,
    generatedByName: options.generatedByName,
    isConfirmed: options.isConfirmed,
    fixes,
    okItems: sortJudgements(okItems),
    postponedItems: sortJudgements(postponedItems),
    openItems: sortJudgements(openItems),
    summary: {
      vehicles: grid.rows.length,
      cleanVehicles: grid.review.cleanVehicles,
      fixedVehicles: fixes.length,
      ok: okItems.length,
      postponed: postponedItems.length,
      open: openItems.length,
    },
  };
}
