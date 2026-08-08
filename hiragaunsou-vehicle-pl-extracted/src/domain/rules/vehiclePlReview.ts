/**
 * 収支表の「ここを確認してほしい」を、出来上がった表そのものから見つけるルール。
 *
 * 狙いは、CSVを入れた時点で表がほぼ完成していて、人がやることを
 * 「印の付いたセルだけ見て、OKかNGかを決める」に絞り込むこと。
 * そのためには印を付けるだけでは足りず、なぜそう判断したのか(何と比べて
 * おかしいのか)を値で示す必要がある。判断材料が無い印は、結局全部を
 * 見直す作業に戻ってしまう。
 *
 * 既存の anomalyDetection.ts は「例月中央値・前年同月との統計的な乖離」を扱う。
 * こちらは「取込の紐付けが通っていない/計算の前提が崩れている」という、
 * 統計以前の欠落を扱う。両方を同じ VehiclePlIssue に載せてUIへ渡す。
 *
 * Domain層: フレームワーク非依存。
 */

import type { VehiclePlField } from "../entities/VehiclePl";
import { isTrailerVehicleType } from "./towedVehicle";
import {
  isOverridableField,
  OVERRIDABLE_FIELD_META,
  type OverridableField,
} from "./vehiclePlOverride";

/**
 * blocking : このまま確定すると数字が間違っている。直すまで確定させない。
 * warning  : 値としては成立するが、実態と違う可能性が高い。人の判断が要る。
 * info     : 参考。赤字やExcelとの差など、知らせるだけで判断は不要。
 */
export type ReviewSeverity = "blocking" | "warning" | "info";

export type ReviewIssueCode =
  | "sales_unlinked"
  | "payroll_unlinked"
  | "fuel_missing"
  | "vehicle_master_missing"
  | "nempi_out_of_range"
  | "toll_discount_exceeds"
  | "deficit"
  | "excel_mismatch"
  | "anomaly"
  | "overridden"
  | "trailer_unlinked";

export interface IssueComparison {
  /** 比較の相手が何か (「運行回数」「例月中央値」「Excelの値」など) */
  label: string;
  value: number | string | null;
}

export interface VehiclePlIssue {
  vehicleNo: string;
  /** 印を付けるセル */
  field: VehiclePlField;
  code: ReviewIssueCode;
  severity: ReviewSeverity;
  /** 何が起きているか (1行) */
  title: string;
  /** なぜそう判断したか。人がOK/NGを決めるための根拠。 */
  reason: string;
  value: number | string | null;
  /** 判断材料。ここが空だと「全部見直す」作業に戻るため、可能な限り埋める。 */
  comparisons: IssueComparison[];
  /** 直す場所への導線 (UIがリンクにする) */
  fix: { label: string; href: string } | null;
}

/** 燃費(km/L)の妥当範囲。大型は2〜4、小型でも8程度で、これを外れるのは走行距離か給油量の誤り。 */
const NEMPI_MIN = 1;
const NEMPI_MAX = 10;

function n(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/** 稼働している車両か。稼働ゼロの車(車検中・遊休)に欠落の印を付けても意味がない。 */
function isActive(row: Record<string, unknown>): boolean {
  return n(row.km) > 0 || n(row.trips) > 0 || n(row.hours) > 0;
}

/**
 * 1台分の収支から、紐付けの欠落と計算前提の崩れを見つける。
 *
 * 「稼働しているのに値がゼロ」を欠落とみなすのが基本形。ゼロは「実際にゼロ」と
 * 「取込が通っていない」の両方があり得るが、稼働している車両に限れば後者の可能性が高い。
 */
export function reviewVehicleRow(
  row: Record<string, unknown> & { no: string },
  yearMonth: string,
): VehiclePlIssue[] {
  const issues: VehiclePlIssue[] = [];
  const vehicleNo = row.no;
  const active = isActive(row);
  const push = (issue: Omit<VehiclePlIssue, "vehicleNo">) =>
    issues.push({ vehicleNo, ...issue });

  if (active && n(row.sales) === 0) {
    push({
      field: "sales",
      code: "sales_unlinked",
      severity: "blocking",
      title: "稼働しているのに売上がありません",
      reason:
        "売上モニタリストの車番とこの車両が結び付いていない可能性があります。売上が0のままだと損益が経費の分だけ赤字になります。",
      value: n(row.sales),
      comparisons: [
        { label: "運行回数", value: n(row.trips) },
        { label: "稼働Km", value: n(row.km) },
        { label: "伝票件数", value: n(row.slips) },
      ],
      fix: { label: "売上の取込を確認する", href: `/cleansing?ym=${yearMonth}` },
    });
  }

  if (active && n(row.salary) === 0) {
    push({
      field: "salary",
      code: "payroll_unlinked",
      severity: "blocking",
      title: "稼働しているのに給与が0です",
      reason:
        "給与は社員コード→運転者マスタ→車番の順に辿って集計します。運転者マスタにこの車番が登録されていないと0のままになります。",
      value: n(row.salary),
      comparisons: [
        { label: "運転者名", value: (row.driver as string | null) ?? null },
        { label: "社員コード", value: (row.code as string | null) ?? null },
        { label: "運行回数", value: n(row.trips) },
      ],
      fix: { label: "運転者マスタを確認する", href: "/admin/driver-master" },
    });
  }

  if (active && n(row.fuelQty) === 0) {
    push({
      field: "fuelTotal",
      code: "fuel_missing",
      severity: "blocking",
      title: "燃料が未入力です",
      reason:
        "走行しているのに給油量が0です。燃料費は月次の実績入力から入るため、入力がまだの月はここが空のままになります。",
      value: n(row.fuelTotal),
      comparisons: [{ label: "稼働Km", value: n(row.km) }],
      fix: { label: "燃料費を入力する", href: `/manual-entry?step=3&ym=${yearMonth}` },
    });
  }

  if (n(row.insTotal) === 0 && n(row.taxTotal) === 0 && n(row.transportTotal) === 0) {
    push({
      field: "fixed",
      code: "vehicle_master_missing",
      severity: "warning",
      title: "固定費がすべて0です",
      reason:
        "保険・自動車税・リース/割賦はすべて車両マスタから入ります。3つとも0なのは、この車番が車両マスタに登録されていない可能性が高いことを示します。",
      value: n(row.fixed),
      comparisons: [
        { label: "車種名", value: (row.type as string | null) ?? null },
        { label: "所属", value: (row.depot as string | null) ?? null },
      ],
      fix: { label: "車両マスタを確認する", href: "/admin/vehicle-master" },
    });
  }

  const nempi = n(row.nempi);
  if (nempi > 0 && (nempi < NEMPI_MIN || nempi > NEMPI_MAX)) {
    push({
      field: "nempi",
      code: "nempi_out_of_range",
      severity: "warning",
      title: "燃費が現実的な範囲を外れています",
      reason: `燃費は稼働Km÷給油量です。${NEMPI_MIN}〜${NEMPI_MAX}km/Lを外れる場合、走行距離か給油量のどちらかが実態と違います。`,
      value: nempi,
      comparisons: [
        { label: "稼働Km", value: n(row.km) },
        { label: "給油量合計", value: n(row.fuelQty) },
        { label: "妥当な範囲", value: `${NEMPI_MIN}〜${NEMPI_MAX}` },
      ],
      fix: { label: "燃料費を入力する", href: `/manual-entry?step=3&ym=${yearMonth}` },
    });
  }

  if (n(row.tollDisc) > n(row.toll)) {
    push({
      field: "tollDisc",
      code: "toll_discount_exceeds",
      severity: "warning",
      title: "高速割引が通行料を上回っています",
      reason:
        "割引額が通行料より大きいと運行費計がマイナスになります。請求書の割引額の入力先か、通行料の実費入力を確認してください。",
      value: n(row.tollDisc),
      comparisons: [{ label: "道路使用料", value: n(row.toll) }],
      fix: { label: "高速料金を入力する", href: `/manual-entry?step=6&ym=${yearMonth}` },
    });
  }

  // 赤字そのものは誤りではないが、上の欠落が原因で赤字に見えている月がある。
  // 欠落を1つでも検出した車両では、赤字を独立した所見として重ねない。
  if (n(row.profit) < 0 && issues.length === 0) {
    push({
      field: "profit",
      code: "deficit",
      severity: "info",
      title: "赤字です",
      reason: "入力の欠落は見つかりませんでした。実力として赤字の可能性があります。",
      value: n(row.profit),
      comparisons: [
        { label: "運送収入", value: n(row.sales) },
        { label: "経費計", value: n(row.expense) },
      ],
      fix: { label: "この車両を詳しく見る", href: `/vehicle/${encodeURIComponent(vehicleNo)}?ym=${yearMonth}` },
    });
  }

  return issues;
}

export function reviewMonthlyPl(
  rows: readonly (Record<string, unknown> & { no: string })[],
  yearMonth: string,
): VehiclePlIssue[] {
  return rows.flatMap((row) => reviewVehicleRow(row, yearMonth));
}

/**
 * 完成済みExcelとの差を所見に変換する。
 *
 * 差が出た側がどちらの誤りかは機械には決められない。Excel側の手作業ミスかもしれないし、
 * こちらの取込漏れかもしれない。だから severity は info に留め、両方の値を並べて
 * 人がどちらを採るか決められる形にする。判断材料を出すことが目的で、判定は目的ではない。
 */
export function excelMismatchIssues(
  reconciliation: {
    vehicles: readonly {
      vehicleNo: string;
      items: readonly { field: string; label: string; excel: number; system: number; diff: number }[];
    }[];
  },
  yearMonth: string,
): VehiclePlIssue[] {
  return reconciliation.vehicles.flatMap((vehicle) =>
    vehicle.items.map((item) => ({
      vehicleNo: vehicle.vehicleNo,
      field: item.field as VehiclePlField,
      code: "excel_mismatch" as const,
      severity: "info" as const,
      title: `Excelと ${formatSignedYen(item.diff)} 違います`,
      reason:
        "手作業で作った収支表と値が食い違っています。どちらが正しいかは中身を見ないと決められないため、両方の値を並べています。",
      value: item.system,
      comparisons: [
        { label: "Excelの値", value: item.excel },
        { label: "このシステムの値", value: item.system },
        { label: "差 (システム − Excel)", value: item.diff },
      ],
      fix: {
        label: "この車両を詳しく見る",
        href: `/vehicle/${encodeURIComponent(vehicle.vehicleNo)}?ym=${yearMonth}`,
      },
    })),
  );
}

/**
 * けん引先が登録されていないトレーラ(被けん引車)を指摘する。
 *
 * トレーラは運賃も運転者も付かないのに保険・税・リース料だけが付くので、単独の行として
 * 残ると必ず「売上ゼロの赤字行」になる。現行Excelの最終成果物ではけん引するトラクタの行に
 * まとめられており、106行が101行になる差はこれ。
 *
 * 対応表は元データのどのCSVにも無く、Excelの行ラベル(「129/1113」)だけが持っている。
 * つまり人が車両マスタで登録するまで自動では埋まらないので、行が残っている限り出し続ける。
 * severity を warning にしているのは、放置しても計算は壊れないが台数と損益の見え方が
 * Excel と揃わないため (blocking にすると、意図して単独運用している車両で作業が止まる)。
 */
export function unlinkedTrailerIssues(
  rows: readonly { vehicleNo: string; type?: string | null; sales?: number | null; expense?: number | null }[],
  yearMonth: string,
): VehiclePlIssue[] {
  return rows
    .filter((row) => isTrailerVehicleType(row.type ?? ""))
    .map((row) => ({
      vehicleNo: row.vehicleNo,
      field: "no" as VehiclePlField,
      code: "trailer_unlinked" as const,
      severity: "warning" as const,
      title: "トレーラのけん引先が登録されていません",
      reason:
        "被けん引車は運賃も運転者も付かないため、単独の行のままだと費用だけの赤字行になります。" +
        "車両マスタでけん引するトラクタを選ぶと、その行に合算され車番も「129/1113」の形にまとまります。",
      value: row.vehicleNo,
      comparisons: [
        { label: "この行の運送収入", value: row.sales ?? 0 },
        { label: "この行の経費計", value: row.expense ?? 0 },
        { label: "車種名", value: row.type ?? "—" },
      ],
      fix: { label: "車両マスタでけん引先を登録する", href: `/admin/vehicle-master?ym=${yearMonth}` },
    }));
}

/**
 * 車両単位の最終上書きを所見に変換する。
 *
 * 上書きした値は「確認済み」なので指摘ではない。ただし人が手を入れた行だと分からないまま
 * 翌月に引き継がれると、上書きの存在ごと忘れられて元に戻ってしまう。
 * だから severity は info に固定し、消さずに残す印として出す。
 */
export function overrideIssues(
  overrides: readonly {
    vehicleNo: string;
    excluded: boolean;
    values: Partial<Record<string, number>>;
    reason: string;
    updatedByName?: string | null;
  }[],
  currentValues: ReadonlyMap<string, Record<string, unknown>>,
  yearMonth: string,
): VehiclePlIssue[] {
  return overrides
    .filter((o) => !o.excluded)
    .flatMap((o) =>
      Object.entries(o.values)
        .filter(([field]) => isOverridableField(field))
        .map(([field, value]) => ({
          vehicleNo: o.vehicleNo,
          field: field as VehiclePlField,
          code: "overridden" as const,
          severity: "info" as const,
          title: `${OVERRIDABLE_FIELD_META[field as OverridableField].label}は人が直した値です`,
          reason: o.reason,
          value: value ?? null,
          comparisons: [
            { label: "いまの値(上書き後)", value: value ?? null },
            {
              label: "本来の出どころ",
              value: OVERRIDABLE_FIELD_META[field as OverridableField].source,
            },
            ...(o.updatedByName ? [{ label: "直した人", value: o.updatedByName }] : []),
          ],
          fix: {
            label: "上書きを見直す",
            href: `/vehicle/${encodeURIComponent(o.vehicleNo)}?ym=${yearMonth}`,
          },
        })),
    )
    .filter((issue) => currentValues.has(issue.vehicleNo));
}

function formatSignedYen(diff: number): string {
  const sign = diff > 0 ? "+" : "−";
  return `${sign}${Math.abs(Math.round(diff)).toLocaleString("ja-JP")}円`;
}

/**
 * 例月中央値・前年同月との乖離(anomalyDetection.ts の結果)を所見に変換する。
 * 統計的な乖離は誤りとは限らないので warning 止まりにし、比較した相手の値を必ず添える。
 */
export function anomalyIssues(
  flags: readonly {
    vehicleNo: string;
    field: string;
    type: string;
    message: string;
    monthlyReference: number | null;
    value: number | null;
  }[],
  yearMonth: string,
): VehiclePlIssue[] {
  return flags.map((flag) => ({
    vehicleNo: flag.vehicleNo,
    field: flag.field as VehiclePlField,
    code: "anomaly" as const,
    severity: "warning" as const,
    title: "例月と比べて外れた値です",
    reason: flag.message,
    value: flag.value,
    comparisons:
      flag.monthlyReference == null
        ? []
        : [
            { label: flag.type === "yoy_deviation" ? "前年同月" : "例月中央値", value: flag.monthlyReference },
            { label: "この月の値", value: flag.value },
          ],
    fix: { label: "異常値の判定へ", href: `/anomaly?ym=${yearMonth}` },
  }));
}

/** severity の重い順。UIの並べ替えと、行の代表色の決定に使う。 */
export const SEVERITY_ORDER: Record<ReviewSeverity, number> = {
  blocking: 0,
  warning: 1,
  info: 2,
};

export function heaviestSeverity(issues: readonly VehiclePlIssue[]): ReviewSeverity | null {
  let heaviest: ReviewSeverity | null = null;
  for (const issue of issues) {
    if (!heaviest || SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[heaviest]) {
      heaviest = issue.severity;
    }
  }
  return heaviest;
}
