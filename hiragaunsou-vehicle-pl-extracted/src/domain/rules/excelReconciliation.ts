import type { VehiclePlCalculated } from "./vehiclePlCalculation";

/**
 * 完成済みExcel(★車両別収支表)と、本システムが計算した収支の車番別突合。
 *
 * 方針: Excel側の手作業ミス・不整合にシステムを合わせない。
 * 差が出た箇所は「Excel側の確認・修正対象」として一覧に出す
 * (例: ※運送費計の列が空のまま隣の2列に同額を入力していた行、賞与が★ブックと年度ブックで食い違う行)。
 *
 * 単位の違う項目(稼働時間・稼働Km・燃費)は混ぜない。同じ表に置くと
 * 「差額の大きい順」が意味を成さなくなるため、金額(円)の項目だけを突合する。
 */
export interface ExcelReconcileField {
  field: keyof VehiclePlCalculated;
  label: string;
}

/** 突合する金額項目。内訳と計を1段ずつ並べ、読んで原因に辿り着ける粒度に留める。 */
export const EXCEL_RECONCILE_FIELDS: readonly ExcelReconcileField[] = [
  { field: "fare", label: "運賃" },
  { field: "fee", label: "附帯料金" },
  { field: "sales", label: "運送収入" },
  { field: "tollNet", label: "運行費計" },
  { field: "fuelTotal", label: "燃料費計" },
  { field: "repairTotal", label: "修繕費計" },
  { field: "laborTotal", label: "人件費計" },
  { field: "insTotal", label: "保険料計" },
  { field: "taxTotal", label: "賦課税計" },
  { field: "transportTotal", label: "運送費計" },
  { field: "adminTotal", label: "管理費計" },
  { field: "expense", label: "経費計" },
  { field: "profit", label: "損益" },
] as const;

/** 表示上の丸め差を食い違いとして扱わない許容幅 (円)。 */
export const EXCEL_RECONCILE_TOLERANCE = 1;

export interface ExcelReconcileItem {
  field: string;
  label: string;
  excel: number;
  system: number;
  /** システム − Excel */
  diff: number;
}

export interface ExcelReconcileVehicle {
  vehicleNo: string;
  driver: string | null;
  /** 差の大きい項目から並ぶ */
  items: ExcelReconcileItem[];
  /** その車両の最大の差額 (並び順のキー) */
  maxAbsDiff: number;
}

export interface ExcelReconcileResult {
  /** 完成済みExcelが取り込まれているか */
  hasExcel: boolean;
  /** 両方に存在し突合できた車両数 */
  comparedCount: number;
  excelOnlyCount: number;
  systemOnlyCount: number;
  /** 食い違いのあった車両 (差額の大きい順) */
  vehicles: ExcelReconcileVehicle[];
  mismatchItemCount: number;
}

export function reconcileWithExcel(
  excelRows: readonly VehiclePlCalculated[],
  systemRows: readonly VehiclePlCalculated[],
): ExcelReconcileResult {
  const empty: ExcelReconcileResult = {
    hasExcel: excelRows.length > 0,
    comparedCount: 0,
    excelOnlyCount: 0,
    systemOnlyCount: 0,
    vehicles: [],
    mismatchItemCount: 0,
  };
  if (excelRows.length === 0) return empty;

  const systemByNo = new Map(systemRows.map((r) => [r.no, r]));
  const excelByNo = new Map(excelRows.map((r) => [r.no, r]));

  const vehicles: ExcelReconcileVehicle[] = [];
  let comparedCount = 0;
  let mismatchItemCount = 0;

  for (const excel of excelRows) {
    const system = systemByNo.get(excel.no);
    if (!system) continue;
    comparedCount += 1;

    const items: ExcelReconcileItem[] = [];
    for (const { field, label } of EXCEL_RECONCILE_FIELDS) {
      const expected = excelValueOf(excel, field);
      const actual = numberOf(system[field]);
      const diff = actual - expected;
      if (Math.abs(diff) <= EXCEL_RECONCILE_TOLERANCE) continue;
      items.push({ field, label, excel: expected, system: actual, diff });
    }
    if (items.length === 0) continue;

    items.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    mismatchItemCount += items.length;
    vehicles.push({
      vehicleNo: excel.no,
      driver: excel.driver ?? system.driver ?? null,
      items,
      maxAbsDiff: Math.max(...items.map((item) => Math.abs(item.diff))),
    });
  }

  vehicles.sort((a, b) => b.maxAbsDiff - a.maxAbsDiff);

  return {
    hasExcel: true,
    comparedCount,
    excelOnlyCount: excelRows.filter((r) => !systemByNo.has(r.no)).length,
    systemOnlyCount: systemRows.filter((r) => !excelByNo.has(r.no)).length,
    vehicles,
    mismatchItemCount,
  };
}

/**
 * Excel側の値を1つ取り出す。
 * ★収支表にはAC列(※修繕費計)が空のままAB列(メンテ)に計が入っている行があり、
 * そのまま0として比べると全車両が不一致になって一覧が使い物にならないため、
 * 修繕費計だけは「空ならメンテ列を計とみなす」列の揺れを吸収する。
 */
function excelValueOf(row: VehiclePlCalculated, field: keyof VehiclePlCalculated): number {
  const value = numberOf(row[field]);
  if (field === "repairTotal" && value === 0) return numberOf(row.mainte);
  return value;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
