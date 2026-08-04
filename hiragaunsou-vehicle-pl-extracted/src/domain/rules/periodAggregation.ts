/**
 * 任意期間 (複数月横断) の集計ルール。
 *
 * 既存の monthlyAggregation は「1ヶ月の全社集計」までしか担わない。
 * ダッシュボードで「直近12ヶ月」「4〜6月の3ヶ月」のように月をまたいで見るには、
 * 車両単位・営業所単位でも月をまたいで足し合わせる必要があるため、ここに切り出す。
 *
 * Domain層: フレームワーク非依存。D1・fetch等の外部依存を import しない。
 */
import type { VehiclePlCalculated } from "./vehiclePlCalculation";
import type { MonthTotals } from "./monthlyAggregation";

/* ------------------------------------------------------------------ *
 * 期間の列挙
 * ------------------------------------------------------------------ */

function parse(yearMonth: string): { year: number; month: number } {
  const [y, m] = yearMonth.split("-");
  return { year: Number(y), month: Number(m) };
}

function format(year: number, monthIndex0: number): string {
  const date = new Date(Date.UTC(year, monthIndex0, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 通し番号 (年*12+月)。年またぎの引き算を単純にするための内部表現。 */
function ordinal(yearMonth: string): number {
  const { year, month } = parse(yearMonth);
  return year * 12 + (month - 1);
}

/**
 * from〜to を昇順で列挙する (両端を含む)。
 * from > to のときは空配列。画面から逆順で渡っても例外にせず、空状態として扱わせる。
 */
export function periodYearMonths(from: string, to: string): string[] {
  const start = ordinal(from);
  const end = ordinal(to);
  if (start > end) return [];
  const { year } = parse(from);
  const startMonthIndex0 = parse(from).month - 1;
  return Array.from({ length: end - start + 1 }, (_, i) => format(year, startMonthIndex0 + i));
}

/** 期間の表示ラベル。単月と複数月で言い方を変える。 */
export function periodLabel(yearMonths: readonly string[]): string {
  const first = yearMonths[0];
  const last = yearMonths[yearMonths.length - 1];
  if (first === undefined || last === undefined) return "—";
  const label = (ym: string) => {
    const { year, month } = parse(ym);
    return `${year}年${month}月`;
  };
  if (first === last) return label(first);
  return `${label(first)}〜${label(last)} (${yearMonths.length}ヶ月)`;
}

/** 期間全体を1年前にずらした年月の並び (対前年比較の相手) */
export function previousYearOf(yearMonths: readonly string[]): string[] {
  return yearMonths.map((ym) => {
    const { year, month } = parse(ym);
    return format(year - 1, month - 1);
  });
}

/** 指定月の1ヶ月前 (対前月比較の相手) */
export function monthBefore(yearMonth: string): string {
  const { year, month } = parse(yearMonth);
  return format(year, month - 2);
}

/* ------------------------------------------------------------------ *
 * 経費の構成比
 * ------------------------------------------------------------------ */

export type CostSliceKey =
  | "laborTotal"
  | "fuelTotal"
  | "tollNet"
  | "repairTotal"
  | "transportTotal"
  | "adminTotal"
  | "insTotal"
  | "taxTotal";

export interface CostSlice {
  key: CostSliceKey;
  label: string;
  amount: number;
  /** 経費計に対する構成比。経費計0なら null (0除算を画面に漏らさない) */
  share: number | null;
}

/** 科目の表示名。収支表51列の「〜計」列と1対1で対応させる。 */
const COST_LABELS: Record<CostSliceKey, string> = {
  laborTotal: "人件費",
  fuelTotal: "燃料費",
  tollNet: "運行費",
  repairTotal: "修繕費",
  transportTotal: "リース・割賦",
  adminTotal: "一般管理費",
  insTotal: "保険料",
  taxTotal: "賦課税",
};

const COST_KEYS = Object.keys(COST_LABELS) as CostSliceKey[];

/** 経費を科目別に分解し、金額の大きい順に返す (どこに効くかを上から読める順序にする)。 */
export function costBreakdown(totals: MonthTotals): CostSlice[] {
  const expense = totals.expense;
  return COST_KEYS.map((key) => ({
    key,
    label: COST_LABELS[key],
    amount: totals[key],
    share: expense === 0 ? null : totals[key] / expense,
  })).sort((a, b) => b.amount - a.amount);
}

/* ------------------------------------------------------------------ *
 * 車両単位・営業所単位の期間集計
 * ------------------------------------------------------------------ */

export interface VehicleAggregate {
  vehicleNo: string;
  type: string;
  depot: string;
  driver: string;
  sales: number;
  expense: number;
  profit: number;
  km: number;
  /** その車両のデータが存在した月数 (期の途中で入れ替わった車を見分ける) */
  monthCount: number;
}

/** 所属未記入の車両をまとめる先。空文字のまま集計すると営業所比較で無名の行ができる。 */
export const UNSET_DEPOT = "未設定";

/**
 * 月 → 行の並びを、車番単位の期間合計に畳む。
 * 車種・所属・運転者は「最新月の値」を採る。期の途中で乗務員や配属が変わった車両では、
 * 古い月の値を残すと現在の担当に連絡できず、打ち手に繋がらないため。
 */
export function aggregateByVehicle(
  byMonth: ReadonlyMap<string, readonly VehiclePlCalculated[]>,
): VehicleAggregate[] {
  const acc = new Map<string, VehicleAggregate>();
  // 最新月の属性で上書きしたいので、年月の昇順で走査する
  const yearMonths = [...byMonth.keys()].sort();

  for (const ym of yearMonths) {
    for (const row of byMonth.get(ym) ?? []) {
      const current = acc.get(row.no);
      const base = current ?? {
        vehicleNo: row.no,
        type: "",
        depot: "",
        driver: "",
        sales: 0,
        expense: 0,
        profit: 0,
        km: 0,
        monthCount: 0,
      };
      acc.set(row.no, {
        vehicleNo: row.no,
        type: row.type,
        depot: row.depot,
        driver: row.driver ?? "",
        sales: base.sales + row.sales,
        expense: base.expense + row.expense,
        profit: base.profit + row.profit,
        km: base.km + row.km,
        monthCount: base.monthCount + 1,
      });
    }
  }
  return [...acc.values()];
}

/** 損失の大きい順 (損益の小さい順) に limit 件。黒字車は含めない。 */
export function deficitRanking(
  list: readonly VehicleAggregate[],
  limit: number,
): VehicleAggregate[] {
  return list
    .filter((v) => v.profit < 0)
    .sort((a, b) => a.profit - b.profit)
    .slice(0, limit);
}

export interface DepotAggregate {
  depot: string;
  cars: number;
  deficitCars: number;
  sales: number;
  expense: number;
  profit: number;
  /** 利益率。売上0なら null */
  margin: number | null;
}

/** 営業所別の集計。売上の大きい順 (規模の大きい拠点から読ませる)。 */
export function aggregateByDepot(list: readonly VehicleAggregate[]): DepotAggregate[] {
  const acc = new Map<string, DepotAggregate>();
  for (const v of list) {
    const depot = v.depot.trim() === "" ? UNSET_DEPOT : v.depot;
    const base =
      acc.get(depot) ??
      { depot, cars: 0, deficitCars: 0, sales: 0, expense: 0, profit: 0, margin: null };
    acc.set(depot, {
      depot,
      cars: base.cars + 1,
      deficitCars: base.deficitCars + (v.profit < 0 ? 1 : 0),
      sales: base.sales + v.sales,
      expense: base.expense + v.expense,
      profit: base.profit + v.profit,
      margin: null,
    });
  }
  return [...acc.values()]
    .map((d) => ({ ...d, margin: d.sales === 0 ? null : d.profit / d.sales }))
    .sort((a, b) => b.sales - a.sales);
}

/* ------------------------------------------------------------------ *
 * 対前年
 * ------------------------------------------------------------------ */

/**
 * 増減率。前期が0なら比較不能として null。
 * 分母は絶対値を使う。前期が赤字(負値)のとき素の比率を取ると
 * 「赤字が縮んだ」のに負の伸び率が出て意味が反転するため。
 */
export function diffRatio(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
