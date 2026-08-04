import type { VehiclePlField } from "../../src/domain/entities/VehiclePl";

/** グリッド表示用の日本語ラベル (Presentation層のみ。Domain層の列定義には手を入れない) */
export const FIELD_LABELS: Record<VehiclePlField, string> = {
  no: "車番",
  type: "車種名",
  depot: "所属",
  reg: "初年度登録",
  code: "社員コード",
  driver: "運転者名",
  trips: "運行回数",
  slips: "伝票件数",
  hours: "稼働時間",
  km: "稼働Km",
  fare: "運賃",
  fee: "附帯料金",
  sales: "運送収入",
  toll: "道路使用料",
  tollDisc: "高速割引料",
  tollNet: "運行費計",
  fuelIn: "軽油代(内)",
  fuelInQty: "インタンク給油量",
  fuelOut: "軽油代(外)",
  fuelOutQty: "外部給油量",
  fuelQty: "給油量合計",
  nempi: "燃費",
  adblue: "アドブルー",
  fuelTotal: "燃料費計",
  repair: "修理費",
  tire: "タイヤ費",
  equip: "備品費",
  mainte: "メンテ費",
  repairTotal: "修繕費計",
  salary: "給与",
  bonus: "賞与",
  welfare: "福利厚生費",
  laborTotal: "人件費計",
  insCompulsory: "自賠責保険",
  insVoluntary: "任意保険",
  insTotal: "保険料計",
  taxAuto: "自動車税",
  taxWeight: "重量税",
  taxTotal: "賦課税計",
  miscOther: "その他諸経費",
  miscTotal: "諸経費計",
  lease: "リース費",
  installment: "割賦支払費",
  transportTotal: "運送費計",
  adminFee: "一般管理費",
  adminTotal: "管理費計",
  fixed: "固定費",
  variable: "変動費",
  expense: "経費計",
  profit: "損益",
  margin: "利益率",
};

const TEXT_FIELDS = new Set<VehiclePlField>(["no", "type", "depot", "reg", "code", "driver"]);

export function isNumericField(field: VehiclePlField): boolean {
  return !TEXT_FIELDS.has(field);
}

export function formatCellValue(field: VehiclePlField, value: number | string | null): string {
  if (value === null || value === undefined) return "—";
  if (!isNumericField(field)) return String(value);
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  if (field === "margin") return `${(n * 100).toFixed(1)}%`;
  if (field === "nempi") return n.toFixed(2);
  return Math.round(n).toLocaleString("ja-JP");
}
