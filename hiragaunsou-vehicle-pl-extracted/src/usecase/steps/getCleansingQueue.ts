import { slipKey, type SalesMonitorRow } from "../../infrastructure/parsers/salesMonitorParser";
import {
  detectCleansingFlags,
  needsHumanDecision,
  suggestDecision,
  type CleansingDecisionType,
  type CleansingFlag,
} from "../../domain/rules/cleansingRules";
import type { ImportBatchRepository } from "../../domain/repositories/VehiclePlRepository";
import type {
  CleansingDecisionRecord,
  CleansingDecisionRepository,
} from "../../domain/repositories/CleansingDecisionRepository";

/**
 * 業務フロー STEP1「データ整形(傭車・2重計上・諸口の処理)」の要判断リストを組み立てるユースケース。
 *
 * 全伝票を人に見せると数千行になり判断できない。フラグが立った行だけを、
 * 判断に必要な情報(荷主・積荷日・運賃・立ったフラグの理由・前月の判断)とともに出す。
 *
 * 傭車(88888)は自動除外済みなので判断リストには出さず、件数だけ「自動で除外しました」と示す。
 */
export const CLEANSING_SOURCE_TYPE = "sales_monitor";

export interface CleansingQueueItem {
  /** 伝票の自然キー (管理№-行№)。判断の保存キーになる */
  rowKey: string;
  vehicleNo: string;
  driverName: string;
  customerName: string;
  loadDate: string;
  /** 受取運賃 + 附帯料金。金額の大きさが判断の優先順位になる */
  amount: number;
  flags: CleansingFlag[];
  /** すでに今月分の判断が下されていれば、その内容 */
  decision: CleansingDecisionType | null;
  correctedVehicleNo: string | null;
  note: string | null;
  /** 前月以前の同じ伝票への判断からの提案 (自動適用はしない) */
  suggestion: { decision: CleansingDecisionType; reason: string } | null;
}

export interface CleansingQueueResult {
  yearMonth: string;
  /** 売上モニタリストが未取込 */
  notImported: boolean;
  items: CleansingQueueItem[];
  /** 車番88888で自動除外した伝票数 */
  charteredExcluded: number;
  /** 取り込んだ伝票の総数 */
  totalRows: number;
  /** まだ判断が下されていない件数。0 になったら STEP1 完了 */
  pendingCount: number;
  /** 人が「除外する」と判断した件数 */
  excludedCount: number;
}

/**
 * STEP1で下した判断を売上伝票に反映する (収支確定の直前に適用する)。
 *
 * - delete: その伝票を集計から落とす
 * - correct: 正しい車番へ付け替えて残す (付け替え先の指定が無ければ何もしない)
 * - keep: そのまま
 *
 * 元データ(raw_ingestion)は書き換えない。判断は別テーブルに持ち、集計時に重ねる。
 * こうしておくと判断をやり直したときに再取込が要らず、なぜその数字なのかも追える。
 */
export function applyCleansingDecisions(
  rows: readonly SalesMonitorRow[],
  decisions: readonly CleansingDecisionRecord[],
): SalesMonitorRow[] {
  if (decisions.length === 0) return [...rows];
  const byRowKey = new Map(decisions.map((d) => [d.rowKey, d]));

  const result: SalesMonitorRow[] = [];
  for (const [index, row] of rows.entries()) {
    const decision = byRowKey.get(slipKey(row, index));
    if (!decision) {
      result.push(row);
      continue;
    }
    if (decision.decision === "delete") continue;
    if (decision.decision === "correct" && decision.correctedVehicleNo) {
      result.push({ ...row, vehicleCode: decision.correctedVehicleNo });
      continue;
    }
    result.push(row);
  }
  return result;
}

export class GetCleansingQueueUseCase {
  constructor(
    private readonly importBatchRepo: ImportBatchRepository,
    private readonly cleansingDecisionRepo: CleansingDecisionRepository,
  ) {}

  async execute(yearMonth: string): Promise<CleansingQueueResult> {
    const [rawRows, batch] = await Promise.all([
      this.importBatchRepo.findRawRows(yearMonth, CLEANSING_SOURCE_TYPE),
      this.importBatchRepo.findLatestBatch(yearMonth, CLEANSING_SOURCE_TYPE),
    ]);

    if (rawRows.length === 0) {
      return {
        yearMonth,
        notImported: true,
        items: [],
        charteredExcluded: 0,
        totalRows: 0,
        pendingCount: 0,
        excludedCount: 0,
      };
    }

    const rows = rawRows.map((r) => r.raw as SalesMonitorRow);

    // 傭車は取込時に落としているので raw_ingestion には残っていない。件数はバッチから取る。
    const charteredExcluded = batch?.excludedRowCount ?? 0;
    const candidates: { row: SalesMonitorRow; rowKey: string; flags: CleansingFlag[] }[] = [];

    for (const [index, row] of rows.entries()) {
      const flags = detectCleansingFlags({
        vehicleNo: row.vehicleCode ?? "",
        driverName: row.driverName ?? "",
      });
      if (!needsHumanDecision(flags)) continue;
      candidates.push({ row, rowKey: slipKey(row, index), flags });
    }

    const [decisions, previous] = await Promise.all([
      this.cleansingDecisionRepo.findByYearMonth(yearMonth, CLEANSING_SOURCE_TYPE),
      this.cleansingDecisionRepo.findPreviousDecisions(
        CLEANSING_SOURCE_TYPE,
        candidates.map((c) => c.rowKey),
        yearMonth,
      ),
    ]);

    const decisionByRowKey = new Map(decisions.map((d) => [d.rowKey, d]));
    const previousByRowKey = new Map(previous.map((d) => [d.rowKey, d]));

    const items: CleansingQueueItem[] = candidates.map(({ row, rowKey, flags }) => {
      const decided = decisionByRowKey.get(rowKey);
      const prev = previousByRowKey.get(rowKey);
      return {
        rowKey,
        vehicleNo: row.vehicleCode ?? "",
        driverName: row.driverName ?? "",
        customerName: row.customerName ?? "",
        loadDate: row.loadDate ?? "",
        amount: (row.fare ?? 0) + (row.ancillaryFee ?? 0),
        flags,
        decision: decided?.decision ?? null,
        correctedVehicleNo: decided?.correctedVehicleNo ?? null,
        note: decided?.note ?? null,
        suggestion: suggestDecision(
          prev ? { decision: prev.decision, yearMonth: prev.yearMonth, note: prev.note } : undefined,
        ),
      };
    });

    // 未判断を先に、そのなかは金額の大きい順。判断の効果が大きいものから片付けられるようにする。
    items.sort((a, b) => {
      if ((a.decision === null) !== (b.decision === null)) return a.decision === null ? -1 : 1;
      return b.amount - a.amount;
    });

    return {
      yearMonth,
      notImported: false,
      items,
      charteredExcluded,
      totalRows: rows.length,
      pendingCount: items.filter((i) => i.decision === null).length,
      excludedCount: items.filter((i) => i.decision === "delete").length,
    };
  }
}
