import { describe, expect, it } from "vitest";
import {
  findRateMasterKeyDef,
  RATE_MASTER_CATALOG,
  validateRateValue,
} from "../../src/domain/rules/rateMasterCatalog";
import { RATE_KEYS } from "../../src/infrastructure/db/D1MasterRepository";

describe("RATE_MASTER_CATALOG", () => {
  /**
   * カタログは管理画面が「設定できる項目」を列挙する唯一の根拠。
   * RATE_KEYS 側にだけ存在するキーがあると、その値は画面から一生変更できないまま
   * 計算にだけ効き続ける (率をマイグレーションでしか変えられなかった状態に戻る)。
   */
  it("RATE_KEYS のキーをすべて網羅する", () => {
    const catalogKeys = new Set(RATE_MASTER_CATALOG.map((d) => d.key));
    const missing = Object.values(RATE_KEYS).filter((k) => !catalogKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("カタログに実在しないキーを含まない", () => {
    const rateKeys = new Set<string>(Object.values(RATE_KEYS));
    const unknown = RATE_MASTER_CATALOG.filter((d) => !rateKeys.has(d.key)).map((d) => d.key);
    expect(unknown).toEqual([]);
  });

  it("キーが重複しない", () => {
    const keys = RATE_MASTER_CATALOG.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("validateRateValue", () => {
  /**
   * 17.48% を 17.48 と入力する事故の入口封じ。これが通ると一般管理費が売上の17倍になり、
   * 全社赤字の収支表が出来上がる。
   */
  it("率に1を超える値を入れさせない", () => {
    const def = findRateMasterKeyDef("admin_fee_rate")!;
    expect(validateRateValue(def, 17.48).ok).toBe(false);
    expect(validateRateValue(def, 0.1748).ok).toBe(true);
  });

  it("円建ての項目は1を超えてよい", () => {
    const def = findRateMasterKeyDef("bonus_annual")!;
    expect(validateRateValue(def, 400000).ok).toBe(true);
  });

  it("負値と非数を弾く", () => {
    const def = findRateMasterKeyDef("bonus_annual")!;
    expect(validateRateValue(def, -1).ok).toBe(false);
    expect(validateRateValue(def, Number.NaN).ok).toBe(false);
  });
});
