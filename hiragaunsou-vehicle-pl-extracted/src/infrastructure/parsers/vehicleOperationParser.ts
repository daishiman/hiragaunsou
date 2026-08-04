import { assertRequiredHeaders, parseCsv, toRecords } from "./csvUtils";
import { decodeCp932 } from "./encoding";
import { parseDurationToHours } from "./timeUtils";
import { parseJapaneseAmount, normalizeKey } from "./numberUtils";

/** 列順が変わっても取り込めるよう、名前で検証する必須列。 */
const REQUIRED_HEADERS = [
  "車両番号",
  "車両名称",
  "所属名称",
  "車種",
  "稼動回数",
  "稼動時間",
  "総距離",
  "総給油量（L）",
  "燃費（km/L）",
] as const;

/**
 * 車両別運行実績表 (ITP-WEBServiceV3出力, デジタコ連携, cp932, 38列) パーサ。
 * 稼働時間/稼働Kmなど、自動流入(層①)の元データを正規化する。
 */
export interface VehicleOperationRecord {
  vehicleCode: string;
  vehicleName: string;
  depot: string;
  vehicleType: string;
  tripCount: number;
  operatingHours: number;
  totalDistanceKm: number;
  totalFuelQtyLiter: number;
  fuelEconomy: number;
  /** 傭車(車番88888相当)を機械的に自動除外してよいためのフラグ */
  isChartered: boolean;
}

export function parseVehicleOperationCsv(input: string | ArrayBuffer | Uint8Array): VehicleOperationRecord[] {
  const text = typeof input === "string" ? input : decodeCp932(input);
  const rows = parseCsv(text);
  assertRequiredHeaders(rows, REQUIRED_HEADERS, "車両別運行実績表");
  const records = toRecords(rows);

  return records
    .filter((r) => (r["車両番号"] ?? "").trim() !== "")
    .map((r) => {
      const vehicleCode = normalizeKey(r["車両番号"]);
      return {
        vehicleCode,
        vehicleName: (r["車両名称"] ?? "").trim(),
        depot: (r["所属名称"] ?? "").trim(),
        vehicleType: (r["車種"] ?? "").trim(),
        tripCount: parseJapaneseAmount(r["稼動回数"]),
        operatingHours: parseDurationToHours(r["稼動時間"]),
        totalDistanceKm: parseJapaneseAmount(r["総距離"]),
        totalFuelQtyLiter: parseJapaneseAmount(r["総給油量（L）"]),
        fuelEconomy: parseJapaneseAmount(r["燃費（km/L）"]),
        isChartered: vehicleCode === "88888",
      };
    });
}
