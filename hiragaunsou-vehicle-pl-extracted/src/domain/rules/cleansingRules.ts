/**
 * 業務フロー STEP2「データ整形(傭車・2重計上・諸口の処理)」の判定ルール。
 * (docxの見出し上はSTEP1配下だが、判定に使う運転者名等は売上モニタリスト(STEP2)にしか無いため、
 *  データとしてはSTEP2に属する。詳細はworkflowSteps.tsのSTEP2定義を参照)
 *
 * 業務フロー docx より:
 *   ・傭車の判定: 車番が「88888」になっているものが傭車 → 機械的に除外してよい
 *   ・2重計上の判定: 過去に 888番・10番・5000番で実際に2重計上が発生した実績あり。
 *     運転者が「諸口」として登録されているデータなどを手がかりに確認。
 *     明確なルール化はされておらず経験則+請求書発行担当への確認で判断(属人化工程)
 *   ・諸口データの扱い: 内容を確認したうえで、必要に応じて修正または削除
 *
 * 属人的な判断そのものは消せない。ここでの方針は
 *   「判定ルールはシステムが持ち、最終判断は人が1クリックで下す」
 * であり、そのため自動で消してよいもの(傭車)と、人に出して判断を仰ぐもの(2重計上疑い・諸口)を
 * 明確に分ける。判断結果は履歴として残し、翌月以降の既定値として提案する。
 *
 * Domain層: フレームワーク非依存。
 */

import { CHARTERED_VEHICLE_NO } from "../entities/VehiclePl";

/**
 * 過去に2重計上が実際に発生した車番。
 * docx に列挙された実績値であり「この車番だけ」という保証はないため、
 * あくまで確認を促すきっかけとして使う(この一覧に無くても諸口フラグ側で拾う)。
 */
export const DUPLICATE_SUSPECT_VEHICLE_NOS = ["888", "10", "5000"] as const;

/** 2重計上・按分計上の手がかりになる運転者名 */
export const MISC_DRIVER_NAME = "諸口";

export type CleansingFlagType =
  /** 傭車 (車番88888)。機械的に除外してよい */
  | "chartered"
  /** 2重計上の疑い (過去に実績のある車番) */
  | "duplicate_suspect"
  /** 諸口として登録された伝票 */
  | "misc_entry";

/** 人が下す最終判断 */
export type CleansingDecisionType =
  /** 収支計算から除外する */
  | "delete"
  /** 金額・車番を直したうえで残す */
  | "correct"
  /** 問題なしとしてそのまま残す */
  | "keep";

export interface CleansingFlag {
  type: CleansingFlagType;
  /** auto = システムが自動処理済み / review = 人の判断が要る */
  severity: "auto" | "review";
  /** なぜフラグが立ったか。画面にそのまま出す(判断の材料を隠さない) */
  reason: string;
}

export interface CleansingCandidateInput {
  vehicleNo: string;
  driverName: string;
}

/**
 * 1行に対して立つフラグを返す。該当なしなら空配列。
 *
 * 傭車は他のフラグと重ならない(そもそも収支計算の対象外)ため、
 * 傭車と判定された時点で他の判定は行わない。
 */
export function detectCleansingFlags(input: CleansingCandidateInput): CleansingFlag[] {
  const vehicleNo = input.vehicleNo.trim();
  const driverName = input.driverName.trim();

  if (vehicleNo === CHARTERED_VEHICLE_NO) {
    return [
      {
        type: "chartered",
        severity: "auto",
        reason: `車番が「${CHARTERED_VEHICLE_NO}」のため傭車です。自社車両の収支計算の対象外として自動で除外しています。`,
      },
    ];
  }

  const flags: CleansingFlag[] = [];

  if ((DUPLICATE_SUSPECT_VEHICLE_NOS as readonly string[]).includes(vehicleNo)) {
    flags.push({
      type: "duplicate_suspect",
      severity: "review",
      reason: `車番「${vehicleNo}」は過去に2重計上が発生した実績があります。同じ伝票が別の車番でも計上されていないか確認してください。`,
    });
  }

  if (driverName === MISC_DRIVER_NAME) {
    flags.push({
      type: "misc_entry",
      severity: "review",
      reason: `運転者が「${MISC_DRIVER_NAME}」で登録されています。内容を確認して、車番を直すか、この伝票を除外するか判定してください。`,
    });
  }

  return flags;
}

/** 人の判断が必要か (傭車のみなら自動処理済みなので不要) */
export function needsHumanDecision(flags: readonly CleansingFlag[]): boolean {
  return flags.some((f) => f.severity === "review");
}

/**
 * 前月に同じ車番+運転者に対して下された判断を、今月の既定値として提案する。
 *
 * 毎月同じ伝票の形で上がってくるものは毎月同じ判断になることが多い。
 * ただし「前月がこうだった」と根拠を見せたうえで人が確認する形にし、
 * 自動適用はしない (静かに間違った判断が積み上がるのを避けるため)。
 */
export interface PreviousDecision {
  decision: CleansingDecisionType;
  yearMonth: string;
  note: string | null;
}

export function suggestDecision(
  previous: PreviousDecision | undefined,
): { decision: CleansingDecisionType; reason: string } | null {
  if (!previous) return null;
  return {
    decision: previous.decision,
    reason: `${previous.yearMonth} は「${DECISION_LABELS[previous.decision]}」と判定しました${
      previous.note ? ` (${previous.note})` : ""
    }。`,
  };
}

export const DECISION_LABELS: Record<CleansingDecisionType, string> = {
  delete: "除外する",
  correct: "直す",
  keep: "このままでよい",
};

export interface ClusterableRow {
  vehicleNo: string;
  driverName: string;
  customerName: string;
  loadDate: string;
  amount: number;
  flags: readonly CleansingFlag[];
}

/**
 * 荷主名の表記ゆれ(全角/半角の(株)、空白の有無など)を吸収して比較できるようにする。
 * 会社名の実体が同じかどうかまでは判定しない。あくまで束ねる/束ねないの誤差を減らすための正規化。
 */
function normalizeCustomerName(name: string): string {
  return name
    .trim()
    .replace(/[（(]株[）)]|㈱|株式会社/g, "")
    .replace(/[（(]有[）)]|㈲|有限会社/g, "")
    .replace(/\s+/g, "");
}

/**
 * 「同じ内容の伝票」とみなす基準。
 *
 * 車番・荷主・金額・立っているフラグの種類が一致する行を同じグループとして束ねる。
 * 積荷日はあえて基準から外している: 車番4242・東洋インキ㈱・700円が日付違いで何件も並ぶような
 * ケース(同一取引が伝票行として分割計上されているとみられるもの)を一括で捌けるようにするため。
 * 一方で金額まで一致させることで、たまたま同じ車番×荷主というだけの別内容の伝票を
 * 誤って一緒くたにしないようにしている。
 *
 * 空文字列を返すと束ねない(driverName が「諸口」等でなければ、そもそも要判断リストに乗らない)。
 */
export function cleansingClusterKey(row: ClusterableRow): string {
  if (!row.vehicleNo || !row.customerName) return "";
  const flagKey = [...row.flags]
    .map((f) => f.type)
    .sort()
    .join("+");
  return [row.vehicleNo, normalizeCustomerName(row.customerName), row.amount, flagKey].join("|");
}

export const FLAG_LABELS: Record<CleansingFlagType, string> = {
  chartered: "傭車",
  duplicate_suspect: "2重計上の疑い",
  misc_entry: "諸口",
};
