/**
 * 率マスタ(rate_master)に置くキーの定義。
 *
 * これまでキー文字列は Infrastructure 層の RATE_KEYS にしか無く、管理画面から
 * 「何を設定できるのか」を列挙する手段が無かった。設定できる項目の一覧は業務の語彙なので
 * Domain 側に置き、Infrastructure と画面の両方がここを参照する。
 *
 * Domain層: フレームワーク非依存。D1・fetch等の外部依存を import しない。
 */

/** 値の意味と表示のしかた。管理画面の入力欄と単位表示がこれで決まる */
export type RateValueKind =
  /** 0〜1 の比率。画面では % で入出力する */
  | "rate"
  /** 円 */
  | "yen"
  /** 円/ℓ */
  | "yen_per_liter"
  /** 円/km */
  | "yen_per_km";

export interface RateMasterKeyDef {
  key: string;
  label: string;
  kind: RateValueKind;
  /**
   * 既定でどちらの粒度で設定する項目か。
   * "common" は全期間共通で持つのが普通の値 (率・規程額)、
   * "monthly" は月ごとに変わるのが普通の値 (仕入単価・その月の受取額)。
   * どちらも両方の粒度で保存でき、月別値があれば共通値より優先される。
   */
  scope: "common" | "monthly";
  /** この値が何に効くか。設定者が影響範囲を判断できるように書く */
  description: string;
}

export const RATE_MASTER_CATALOG: readonly RateMasterKeyDef[] = [
  {
    key: "admin_fee_rate",
    label: "一般管理費率",
    kind: "rate",
    scope: "common",
    description:
      "一般管理費 = 運送収入 × この率。直近3期の一般管理費÷売上の平均として期ごとに改定される。全車両の損益に効く。",
  },
  {
    key: "toll_discount_rate",
    label: "高速組合割引率",
    kind: "rate",
    scope: "common",
    description:
      "高速割引料 = 道路使用料 × この率。高速協の請求書から実費を入力した車両では実費が優先される。",
  },
  {
    key: "bonus_annual",
    label: "賞与 年額",
    kind: "yen",
    scope: "common",
    description: "賞与の月額 = この年額 ÷ 12 × 運転者人数。規程額なので改定時のみ変更する。",
  },
  {
    key: "tank_price",
    label: "インタンク軽油単価",
    kind: "yen_per_liter",
    scope: "monthly",
    description:
      "インタンク軽油代 = 給油量 × この単価。仕入単価は月ごとに動くので、原則その月の値として設定する。",
  },
  {
    key: "deficit_idle_sales",
    label: "赤字3分類: 遊休・低稼働型とみなす売上",
    kind: "yen",
    scope: "common",
    description: "運送収入がこの額未満の赤字車を「遊休・低稼働型」に分類する。判定はこの条件が最優先。",
  },
  {
    key: "deficit_repair_spike",
    label: "赤字3分類: 突発修繕型とみなす修理費",
    kind: "yen",
    scope: "common",
    description: "修理費実費がこの額以上の赤字車を「突発修繕型」に分類する(遊休判定に該当しない場合)。",
  },
  {
    key: "break_even_km_price",
    label: "損益分岐のkm単価",
    kind: "yen_per_km",
    scope: "common",
    description: "ダッシュボードのkm単価分布で「この単価を下回ると赤字」として赤く塗る閾値。分類には使わない。",
  },
  {
    key: "kirin_transport_support",
    label: "キリン 輸送協力金(月額)",
    kind: "yen",
    scope: "monthly",
    description: "その月に受け取った額。対象車番へ按分して運送収入に加える。月ごとに設定する。",
  },
  {
    key: "kirin_management_support",
    label: "キリン 経営支援金(月額)",
    kind: "yen",
    scope: "monthly",
    description: "その月に受け取った額。対象車番へ按分して運送収入に加える。月ごとに設定する。",
  },
];

export function findRateMasterKeyDef(key: string): RateMasterKeyDef | undefined {
  return RATE_MASTER_CATALOG.find((d) => d.key === key);
}

/**
 * 保存してよい値かを判定する。
 *
 * 率を % のつもりで 17.48 と入力する事故を型では防げないので、ここで弾く。
 * 一般管理費率に 17.48 が入ると全車両の一般管理費が売上の17倍になり、
 * 全社が赤字の表が出来上がる。入口で落とす方が、後から気づくより安い。
 */
export function validateRateValue(
  def: RateMasterKeyDef,
  value: number,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(value)) return { ok: false, error: "数値を入力してください" };
  if (value < 0) return { ok: false, error: "0以上の値を入力してください" };
  if (def.kind === "rate" && value > 1) {
    return { ok: false, error: "率は0〜1で入力してください(17.48%なら0.1748)" };
  }
  return { ok: true };
}
