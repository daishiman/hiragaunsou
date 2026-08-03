/**
 * F7 異常検知エンジン: 未入力/桁ミス(例月中央値からの乖離)/前年同月比の自動フラグロジック。
 * 5月入力確認シートで手動/半手動に行っていた判断を統計処理だけで完全自動化する(AI不要, 第一段)。
 * 判定結果は自動修正・自動削除せず、要確認リスト(review_flag)へのフラグ立てに留める。
 */

export type AnomalyType =
  | "missing_input"
  | "digit_suspect"
  | "range_deviation"
  | "yoy_deviation";

export interface AnomalyFlag {
  vehicleNo: string;
  field: string;
  type: AnomalyType;
  message: string;
  /** 判断材料: 例月の目安値 (5月入力確認シートH列相当) */
  monthlyReference: number | null;
  value: number | null;
}

export interface VehicleFieldSnapshot {
  vehicleNo: string;
  field: string;
  value: number | null;
}

/** 必須項目が未入力(null/0/空)かどうかを検知する。0は「未入力」と「実際にゼロ」の両方があり得るため、
 *  hours(稼働時間)やkm(稼働Km)のように稼働していれば必ず正の値になる項目のみ対象にする。
 */
export function detectMissingInput(
  snapshots: VehicleFieldSnapshot[],
  requiredFields: string[],
): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  for (const s of snapshots) {
    if (!requiredFields.includes(s.field)) continue;
    if (s.value == null || s.value === 0) {
      flags.push({
        vehicleNo: s.vehicleNo,
        field: s.field,
        type: "missing_input",
        message: `${s.field} が未入力です`,
        monthlyReference: null,
        value: s.value,
      });
    }
  }
  return flags;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const midValue = sorted[mid] ?? 0;
  const prevValue = sorted[mid - 1] ?? midValue;
  return sorted.length % 2 === 0 ? (prevValue + midValue) / 2 : midValue;
}

/**
 * 例月中央値からの乖離(桁ミス疑い)を検知する。
 * 中央値の `thresholdMultiple` 倍を超える、または `1/thresholdMultiple` 未満の値を疑義として扱う。
 * 既定閾値は要件定義§7-7「過去データ(5月入力確認12件)を教師に調整」を踏まえ 3倍 とする(暫定値、次スライスで調整可能にする)。
 */
export function detectRangeDeviation(
  currentValues: { vehicleNo: string; field: string; value: number }[],
  thresholdMultiple = 3,
): AnomalyFlag[] {
  const byField = new Map<string, { vehicleNo: string; value: number }[]>();
  for (const v of currentValues) {
    const list = byField.get(v.field) ?? [];
    list.push({ vehicleNo: v.vehicleNo, value: v.value });
    byField.set(v.field, list);
  }

  const flags: AnomalyFlag[] = [];
  for (const [field, list] of byField) {
    const positiveValues = list.filter((v) => v.value > 0).map((v) => v.value);
    if (positiveValues.length < 3) continue; // 母数が少なすぎる場合は判定しない
    const med = median(positiveValues);
    if (med === 0) continue;

    for (const item of list) {
      if (item.value <= 0) continue;
      const ratio = item.value / med;
      if (ratio >= thresholdMultiple || ratio <= 1 / thresholdMultiple) {
        flags.push({
          vehicleNo: item.vehicleNo,
          field,
          type: "digit_suspect",
          message: `${field} が例月中央値(${med})の${ratio >= 1 ? ratio.toFixed(1) : (1 / ratio).toFixed(1)}倍${ratio >= 1 ? "" : "未満"}相当で桁ミスの疑いがあります`,
          monthlyReference: med,
          value: item.value,
        });
      }
    }
  }
  return flags;
}

/**
 * 前年同月比の乖離を検知する。thresholdRatio (既定0.5 = ±50%) を超えて変動した場合にフラグを立てる。
 */
export function detectYoyDeviation(
  current: { vehicleNo: string; field: string; value: number }[],
  previousYear: { vehicleNo: string; field: string; value: number }[],
  thresholdRatio = 0.5,
): AnomalyFlag[] {
  const prevMap = new Map(
    previousYear.map((p) => [`${p.vehicleNo}::${p.field}`, p.value]),
  );

  const flags: AnomalyFlag[] = [];
  for (const c of current) {
    const prev = prevMap.get(`${c.vehicleNo}::${c.field}`);
    if (prev == null || prev === 0) continue;
    const diffRatio = (c.value - prev) / prev;
    if (Math.abs(diffRatio) >= thresholdRatio) {
      flags.push({
        vehicleNo: c.vehicleNo,
        field: c.field,
        type: "yoy_deviation",
        message: `${c.field} が前年同月比${(diffRatio * 100).toFixed(1)}%変動しています`,
        monthlyReference: prev,
        value: c.value,
      });
    }
  }
  return flags;
}
