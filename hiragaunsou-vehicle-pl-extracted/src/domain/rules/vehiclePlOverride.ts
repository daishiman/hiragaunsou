/**
 * 車両単位の最終上書き。
 *
 * 現行の運用では、システムが知りようのない事情で最終的な収支表に人が手を入れている。
 * 実データ(2026年5月)で確認できたのは次の3種類:
 *  - 車番10  : 運賃 1,050,000 → 900,000 (請求側の調整。損益が黒字から赤字に変わる)
 *  - 車番303 : 収支をまるごと0にクリア (その月は表に載せない扱い)
 *  - 車番7219: 賞与 25,001 → 25,000 (1円の丸め)
 * これらは元Excel上で直接書き換えられており、システム側に戻ってくる経路が無かった。
 * 毎月同じ手直しを人がやり直す限り、この仕組みは「Excelの前段」にしかなれない。
 *
 * ただし「最終結果を直接書き換えられる」形にはしない。損益や経費計を直に上書きできると
 * 「損益 = 運送収入 - 経費計」が成り立たない行が生まれ、内訳と小計の関係で値の破損を
 * 検出する仕掛け(取込パーサの列ずれはこれで見つかった)が効かなくなる。
 * 上書きできるのは計算の入口の値だけで、下流は必ず再計算させる。
 *
 * Domain層: フレームワーク非依存。
 */

import type { VehiclePlInput } from "./vehiclePlCalculation";

/**
 * 上書きを許すフィールド。
 *
 * ここに載っていない項目は上書きできない。載せる基準は「計算の入口であること」で、
 * 計算結果(sales/expense/profit/margin や各小計)は絶対に載せない。
 * また、既に専用の入力経路がある項目もここには載せない:
 *  - 燃料・修理・タイヤ・備品・メンテ・高速・その他諸経費 → 手入力画面(manual_vehicle_input)
 *  - 保険料・自動車税・重量税・リース料・割賦支払費       → 車両マスタ(STEP7の修正画面)
 * つまりここは「CSVから流れ込む値を、請求側の事情で個別に直す」ための最後の逃げ道になる。
 */
export const OVERRIDABLE_FIELDS = [
  // 運行実績CSV由来の実績値。台数・伝票の重複はクレンジング画面で消せるが、
  // 「数値そのものが実態と違う」場合を直す手段が他に無い。km は標準原価(修理・タイヤ)の
  // 根拠でもあるため、ここを直すと標準原価も併せて正しくなる。
  "trips",
  "slips",
  "hours",
  "km",
  // 売上モニタリスト由来の収入。車番10の運賃 1,050,000 → 900,000 のような
  // 請求側の調整がここに当たる。通行料(toll)は手入力のtollActualが正規経路なので載せない。
  "fare",
  "fee",
  // 給与集計表由来。社員コード→運転者マスタ→車両の連鎖は月中の乗り換えを表現できず、
  // 按分が必要な月に人が直すしかない。
  "salary",
  "welfare",
  // 賞与は「運転者1人あたりの月額×人数」で決まる。人数が実態と違う月をここで直す。
  "driverCount",
  // 人数では表せない賞与の直し(車番7219の 25,001 → 25,000 のような1円の丸め)。
  // 計算結果の bonus ではなく計算の入口の月額を差し替えるので、laborTotal 以下は再計算される。
  "bonusMonthly",
] as const satisfies readonly (keyof VehiclePlInput)[];

export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

export interface VehiclePlOverride {
  vehicleNo: string;
  /** その月の収支表からこの車両を外す (車番303のように「今月は載せない」扱い) */
  excluded: boolean;
  /** 上書きする値。キーは OVERRIDABLE_FIELDS のいずれか。 */
  values: Partial<Record<OverridableField, number>>;
  /** なぜ直したか。後から誰が見ても判断を追えるようにするため必須にする。 */
  reason: string;
}

/** 未知のフィールド名を弾く (APIから任意のキーが流れ込んでも下流を壊さない)。 */
export function isOverridableField(field: string): field is OverridableField {
  return (OVERRIDABLE_FIELDS as readonly string[]).includes(field);
}

/** 画面とAPIで同じ呼び名を使うためのラベル。単位は入力欄の補助表示に使う。 */
export const OVERRIDABLE_FIELD_META: Record<
  OverridableField,
  { label: string; unit: string; source: string }
> = {
  trips: { label: "運行回数", unit: "回", source: "運行実績CSV" },
  slips: { label: "伝票数", unit: "枚", source: "売上モニタリスト" },
  hours: { label: "稼働時間", unit: "時間", source: "運行実績CSV" },
  km: { label: "走行距離", unit: "km", source: "運行実績CSV" },
  fare: { label: "運賃", unit: "円", source: "売上モニタリスト" },
  fee: { label: "附帯料金", unit: "円", source: "売上モニタリスト" },
  salary: { label: "給与", unit: "円", source: "給与集計表" },
  welfare: { label: "福利厚生費", unit: "円", source: "給与集計表" },
  driverCount: { label: "乗務員数", unit: "人", source: "運転者マスタ" },
  bonusMonthly: { label: "賞与(月額)", unit: "円", source: "賞与年額 ÷ 12 × 乗務員数" },
};

/**
 * 保存済みJSONを上書き値に戻す。
 *
 * 定義から外したフィールドが過去の行に残っていても、ここで濾すので計算には届かない。
 * 数値でない値・NaN・無限大も同じ理由で落とす (JSONは何でも入りうる)。
 */
export function parseOverrideValues(json: string): Partial<Record<OverridableField, number>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

  const values: Partial<Record<OverridableField, number>> = {};
  for (const [field, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isOverridableField(field)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    values[field] = value;
  }
  return values;
}

/**
 * 計算の入口の値に上書きを重ねる。
 * 上書きした値から下流(小計・経費計・損益・利益率)は calculateVehiclePl が作り直すため、
 * 内訳と小計の関係は上書き後も必ず成立する。
 */
export function applyVehiclePlOverride(
  input: VehiclePlInput,
  override: VehiclePlOverride | undefined,
): VehiclePlInput {
  if (!override) return input;

  const applied = { ...input };
  for (const [field, value] of Object.entries(override.values)) {
    if (!isOverridableField(field)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    (applied as Record<string, unknown>)[field] = value;
  }
  return applied;
}
