import { assertRequiredHeaders, parseCsv, toRecords } from "./csvUtils";
import { decodeCp932 } from "./encoding";
import { parseJapaneseAmount, normalizeKey } from "./numberUtils";

/** 列順が変わっても取り込めるよう、名前で検証する必須列。 */
const REQUIRED_HEADERS = [
  "車番",
  "車種名",
  "所属",
  "自賠責保険",
  "任意保険",
  "自動車税",
  "自動車重量税",
  "車両リース費",
  "車両割賦支払費",
] as const;

/** 取込に成功した車両マスタ1行 (vehicle_master テーブルへの upsert 単位)。 */
export interface VehicleMasterImportRow {
  vehicleNo: string;
  vehicleType: string;
  depot: string;
  /** STANDARD_COST_RATES のキー (6.5t/large/semiTrailer/unic/medium) */
  costCategory: string;
  insCompulsory: number;
  insVoluntary: number;
  taxAuto: number;
  taxWeight: number;
  lease: number;
  installment: number;
}

/** 取込できなかった行。理由を添えてプレビュー画面に一覧表示し、CSV側を直してもらう。 */
export interface VehicleMasterImportRowError {
  /** ヘッダー行を1行目として数えたCSV上の行番号 (画面で該当行を探せるように) */
  rowNumber: number;
  vehicleNo: string;
  reason: string;
}

/**
 * 車種名 → 原価カテゴリ (STANDARD_COST_RATES のキー) の変換ルール。
 *
 * 元データの「車種名」は入力者の手打ちで表記が揺れる (「大型セミトレーラ」「セミトレ」等)ため、
 * 完全一致ではなく部分一致のパターン表で判定する。上から順に評価するので、より限定的な
 * 分類 (セミトレーラ・ユニック) を先に置く。「大型セミトレーラ」を large ではなく
 * semiTrailer に寄せるための順序であり、並べ替えると判定結果が変わる。
 *
 * 実データの車種名の網羅は運用しながら追加していく前提のため、判定できない車種名は
 * medium へ黙って倒さずエラー行として弾く (原価単価が倍近く違い、収支が静かに狂うため)。
 */
export const COST_CATEGORY_RULES: readonly { costCategory: string; pattern: RegExp }[] = [
  { costCategory: "semiTrailer", pattern: /セミトレ|トレーラ|トレラ|牽引|トラクタ/ },
  { costCategory: "unic", pattern: /ユニック|クレーン/ },
  { costCategory: "6.5t", pattern: /6\.5/ },
  { costCategory: "large", pattern: /大型|増トン|1[0-5]t|1[0-5]トン|[78]t|[78]トン/ },
  { costCategory: "medium", pattern: /中型|小型|準中型|[1-4]t|[1-4]トン|バン|平ボディ/ },
];

/**
 * 表記ゆれの吸収。全角英数字・全角ピリオドを半角へ寄せ、空白を除き、
 * 大文字小文字を無視する ("６．５ｔ ウイング" → "6.5t ウイング" → "6.5tウイング")。
 */
function normalizeVehicleType(value: string): string {
  return value
    .replace(/[Ａ-Ｚａ-ｚ０-９．]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]/g, "")
    .toLowerCase();
}

/** 車種名から原価カテゴリを導く。どのルールにも当てはまらなければ null (呼び出し側でエラー行にする)。 */
export function mapVehicleTypeToCostCategory(vehicleType: string): string | null {
  const normalized = normalizeVehicleType(vehicleType);
  if (normalized === "") return null;
  return COST_CATEGORY_RULES.find((rule) => rule.pattern.test(normalized))?.costCategory ?? null;
}

/**
 * 車両マスタ CSV (社内Excel「★車両別収支計算用」収支表シートから書き出した車両一覧) パーサ。
 * 保険・税・リース料は毎月の収支計算の土台になるため、収支表側を直接いじらず
 * ここからマスタへ一括登録・更新できるようにする (業務フロー STEP7)。
 *
 * 例外ではなく { valid, errors } を返すのは、1行の車種名が判定できないだけで
 * ファイル全体の取込を止めると、実務では毎回全部やり直しになるため。画面側で
 * エラー行を見せたうえで、正常行だけを確定できるようにする。
 */
export function parseVehicleMasterCsv(input: string | ArrayBuffer | Uint8Array): {
  valid: VehicleMasterImportRow[];
  errors: VehicleMasterImportRowError[];
} {
  const text = typeof input === "string" ? input : decodeCp932(input);
  const rows = parseCsv(text);
  assertRequiredHeaders(rows, REQUIRED_HEADERS, "車両マスタ");
  const records = toRecords(rows);

  const valid: VehicleMasterImportRow[] = [];
  const errors: VehicleMasterImportRowError[] = [];

  records.forEach((r, index) => {
    const rowNumber = index + 2; // ヘッダー行を1行目として数える
    // 車番は運行実績の車両番号と同じ正規化 (先頭ゼロ除去) をかける。
    // ここが揃っていないと収支確定時に車両マスタと運行実績が結合できない。
    const vehicleNo = normalizeKey(r["車番"]);
    if (vehicleNo === "") return; // 合計行・空行はエラーにせず読み飛ばす

    const vehicleType = (r["車種名"] ?? "").trim();
    const costCategory = mapVehicleTypeToCostCategory(vehicleType);
    if (!costCategory) {
      errors.push({
        rowNumber,
        vehicleNo,
        reason: `車種名「${vehicleType}」から原価カテゴリ(6.5t/large/semiTrailer/unic/medium)を判定できませんでした`,
      });
      return;
    }

    valid.push({
      vehicleNo,
      vehicleType,
      depot: (r["所属"] ?? "").trim(),
      costCategory,
      insCompulsory: parseJapaneseAmount(r["自賠責保険"]),
      insVoluntary: parseJapaneseAmount(r["任意保険"]),
      taxAuto: parseJapaneseAmount(r["自動車税"]),
      taxWeight: parseJapaneseAmount(r["自動車重量税"]),
      lease: parseJapaneseAmount(r["車両リース費"]),
      installment: parseJapaneseAmount(r["車両割賦支払費"]),
    });
  });

  return { valid, errors };
}
