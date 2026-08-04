import { assertRequiredHeaders, parseCsv, toRecords } from "./csvUtils";
import { decodeCp932 } from "./encoding";
import { parseJapaneseAmount, normalizeKey } from "./numberUtils";
import { CHARTERED_VEHICLE_NO } from "../../domain/entities/VehiclePl";

/** 列順が変わっても取り込めるよう、名前で検証する必須列。 */
const REQUIRED_HEADERS = [
  "車両コード",
  "運転者名",
  "受取運賃",
  "通行料",
  "燃料サーチャージ",
  "待機時間料",
  "付帯料金",
  "管理№",
  "行№",
  "荷主先略称",
  "積荷日",
] as const;

/**
 * 売上モニタリスト (車楽クラウド出力, cp932, 90列) パーサ。
 * 車両コード別に 運賃(受取運賃)・附帯料金・道路使用料(通行料) を集計する。
 *
 * 属人化ポイントは自動削除せず要確認フラグを立てる (要件定義2重計上判定/諸口データ):
 * - 傭車(車両コード=88888)は機械的に自動除外してよい
 * - 運転者名「諸口」は2重計上/仕訳目的の疑いがあるため自動削除せず要確認フラグを立てる
 */
export interface SalesMonitorRow {
  vehicleCode: string;
  driverName: string;
  fare: number; // 受取運賃
  toll: number; // 通行料 (道路使用料)
  /**
   * 収支表 L列「高速他料金」= 通行料 + その他(燃料サーチャージ + 待機時間料 + 付帯料金)。
   * 現行Excelの「車両別売上」シートが 受取運賃 / 通行料 / その他 のピボットを作り、
   * 「他 = 通行料 + その他」を収支表へ転記しているのに合わせる。
   * 顧客への請求分であり、費用側の道路使用料(高速協の請求実費)とは別物なので二重計上ではない。
   */
  ancillaryFee: number;
  isChartered: boolean;
  needsReview: boolean;
  reviewReason: string | null;
  /**
   * STEP2「データ整形」で人が伝票を特定するための識別情報。
   * 管理№+行№は伝票の自然キーなので、再取込しても同じ行を指せる
   * (= 前月と同じ判断を引き継げる)。
   */
  slipNo: string;
  lineNo: string;
  customerName: string;
  loadDate: string;
}

export function parseSalesMonitorCsv(
  input: string | ArrayBuffer | Uint8Array,
): SalesMonitorRow[] {
  const text = typeof input === "string" ? input : decodeCp932(input);
  const rows = parseCsv(text);
  assertRequiredHeaders(rows, REQUIRED_HEADERS, "売上モニタリスト");
  const records = toRecords(rows);

  return records
    .filter((r) => (r["車両コード"] ?? "").trim() !== "")
    .map((r) => {
      const vehicleCode = normalizeKey(r["車両コード"]);
      const driverName = (r["運転者名"] ?? "").trim();
      const isChartered = vehicleCode === CHARTERED_VEHICLE_NO;
      const isMisc = driverName === "諸口";

      return {
        vehicleCode,
        driverName,
        fare: parseJapaneseAmount(r["受取運賃"]),
        toll: parseJapaneseAmount(r["通行料"]),
        ancillaryFee:
          parseJapaneseAmount(r["通行料"]) +
          parseJapaneseAmount(r["燃料サーチャージ"]) +
          parseJapaneseAmount(r["待機時間料"]) +
          parseJapaneseAmount(r["付帯料金"]),
        isChartered,
        needsReview: isMisc,
        reviewReason: isMisc
          ? "運転者名が「諸口」のため2重計上・按分計上の疑いあり(自動削除せず要確認)"
          : null,
        slipNo: (r["管理№"] ?? "").trim(),
        lineNo: (r["行№"] ?? "").trim(),
        customerName: (r["荷主先略称"] ?? "").trim(),
        loadDate: (r["積荷日"] ?? "").trim(),
      };
    });
}

/**
 * 伝票1行を一意に指すキー。STEP2のデータ整形で下した判断を、この行に貼り付けて保存する。
 *
 * 管理№+行№が伝票の自然キーなので、翌月に同じ伝票が上がってきても・当月に再取込しても
 * 同じキーになり、下した判断を引き継げる。
 * 管理№が取れない古い取込データは、行の並び順(index)へフォールバックする。
 */
export function slipKey(
  row: { slipNo?: string; lineNo?: string; vehicleCode: string },
  index: number,
): string {
  const slipNo = (row.slipNo ?? "").trim();
  if (slipNo !== "") return `${slipNo}-${(row.lineNo ?? "").trim()}`;
  return `${row.vehicleCode}#${index}`;
}

export interface VehicleSalesAggregate {
  vehicleCode: string;
  fare: number;
  toll: number;
  ancillaryFee: number;
  slipCount: number;
  hasReviewFlag: boolean;
}

/**
 * 車両コード別に集計する。傭車(88888)は自動除外する。
 * 諸口フラグの行は自動削除せず集計には含めたうえで hasReviewFlag を立てる
 * (要件定義: 自動削除禁止。人間が要確認リストで判断する)。
 */
export function aggregateSalesByVehicle(
  rows: SalesMonitorRow[],
): Map<string, VehicleSalesAggregate> {
  const map = new Map<string, VehicleSalesAggregate>();

  for (const row of rows) {
    if (row.isChartered) continue; // 傭車は機械的に自動除外可

    const existing = map.get(row.vehicleCode) ?? {
      vehicleCode: row.vehicleCode,
      fare: 0,
      toll: 0,
      ancillaryFee: 0,
      slipCount: 0,
      hasReviewFlag: false,
    };

    existing.fare += row.fare;
    existing.toll += row.toll;
    existing.ancillaryFee += row.ancillaryFee;
    existing.slipCount += 1;
    existing.hasReviewFlag = existing.hasReviewFlag || row.needsReview;

    map.set(row.vehicleCode, existing);
  }

  return map;
}
