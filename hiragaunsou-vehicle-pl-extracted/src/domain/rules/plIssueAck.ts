/**
 * 収支表の指摘に対して人が下した判断の印。
 *
 * 指摘 (VehiclePlIssue) は収支表と各マスタから表示のたびに導出されるので、
 * 指摘そのものにIDを持たせられない。代わりに指摘を一意に指す4つ組
 * (年月・車番・列・指摘の種類) をキーにして、判断の印だけを別に保存する。
 *
 * この設計だと、印を付けた後で値が変わって指摘が消えれば、印は自然に画面から消える
 * (キーの指す指摘が存在しなくなるだけで、印の消し込み処理は要らない)。
 * 逆に指摘が残っていれば印も残る。「値が1円でも動いたら確認済みを外す」ようにはしない。
 * 丸めの修正でも確認作業が振り出しに戻り、確認が終わらなくなるため。
 *
 * 判断は2種類ある。どちらも同じキーの上に載るので、保管場所は1つで足りる。
 * - ok    = 見たうえで「このままでよい」と決めた (確認は完了)
 * - later = 「あとで見る」と決めた (確認はまだ終わっていない)
 *
 * Domain層: フレームワーク非依存。
 */

import type { ReviewIssueCode, VehiclePlIssue } from "./vehiclePlReview";

/** 指摘に対する人の判断 */
export type PlIssueAckStatus = "ok" | "later";

export function isPlIssueAckStatus(value: unknown): value is PlIssueAckStatus {
  return value === "ok" || value === "later";
}

/** 確認済みの印が指す指摘。年月は保存の単位なのでキーには含めない(同じ月の中で使う)。 */
export interface PlIssueAckKey {
  vehicleNo: string;
  field: string;
  code: ReviewIssueCode;
}

/**
 * 指摘1件を指す文字列キー。
 * 画面・API・DBの3箇所で同じ組み立て方をする必要があるため、ここに1つだけ置く。
 */
export function plIssueKey(key: PlIssueAckKey): string {
  return `${key.vehicleNo}::${key.field}::${key.code}`;
}

/** 保存済みの判断の印 (誰がいつ判断したかを画面に出すため監査情報を併せて持つ)。 */
export interface PlIssueAckRecord extends PlIssueAckKey {
  status: PlIssueAckStatus;
  note: string | null;
  /** 判断したときの値。翌月に引き継ぐかどうかの判定に使う (取れなかった場合は null) */
  valueAtAck: number | null;
  ackedAt: Date;
  ackedByName: string | null;
}

/** 先月「問題なし」と判断されていた指摘の情報 (今月のカードに出す) */
export interface CarriedOverAck {
  /** 先月その判断を下したときの値 */
  previousValue: number | null;
  ackedByName: string | null;
  ackedAt: number;
}

/** 画面に渡す指摘。導出した指摘に、人が下した判断を重ねたもの。 */
export interface ReviewedIssue extends VehiclePlIssue {
  /** 判断の登録・取消に使うキー */
  key: string;
  /** 「このままでよい」と判断済み (残りの確認件数から外れる) */
  acknowledged: boolean;
  /** 「あとで見る」と判断済み (確認はまだ終わっていない) */
  postponed: boolean;
  ack: {
    status: PlIssueAckStatus;
    note: string | null;
    ackedAt: number;
    ackedByName: string | null;
  } | null;
  /**
   * 先月も同じ指摘を「問題なし」にしていた場合の情報。
   * 黙って隠さず、カードに「先月もOKにした指摘です」と出すために使う。
   */
  carriedOver: CarriedOverAck | null;
}

/**
 * 先月の判断を今月に引き継いで見せてよいかの上限 (値の変化率)。
 *
 * 同じ車両で毎月同じ指摘が出るとき、値がほぼ変わっていないなら先月と同じ判断でよい。
 * 逆に値が大きく動いていれば、先月OKにした理由がそのまま通るとは限らないので引き継がない。
 */
export const CARRY_OVER_MAX_CHANGE_RATIO = 0.2;

/** 先月の判断を今月に持ち込んでよいか (値が大きく変わっていないか) */
export function canCarryOver(previousValue: number | null, currentValue: unknown): boolean {
  // 先月の値が記録されていない (この仕組みより前に付けた印) 場合は、
  // 比べようがないので引き継ぎの案内は出さない。勝手に「同じはず」と見なさない。
  if (previousValue === null || !Number.isFinite(previousValue)) return false;
  const current = Number(currentValue);
  if (!Number.isFinite(current)) return false;
  const base = Math.max(Math.abs(previousValue), 1);
  return Math.abs(current - previousValue) / base <= CARRY_OVER_MAX_CHANGE_RATIO;
}

/**
 * 導出した指摘に判断の印を重ねる。
 *
 * @param acks          今月の判断
 * @param previousAcks  先月の判断 (「先月もOKにした」の案内に使う。無くてもよい)
 */
export function applyIssueAcks(
  issues: readonly VehiclePlIssue[],
  acks: readonly PlIssueAckRecord[],
  previousAcks: readonly PlIssueAckRecord[] = [],
): ReviewedIssue[] {
  const byKey = new Map(acks.map((ack) => [plIssueKey(ack), ack]));
  const previousByKey = new Map(
    previousAcks.filter((ack) => ack.status === "ok").map((ack) => [plIssueKey(ack), ack]),
  );
  return issues.map((issue) => {
    const key = plIssueKey({ vehicleNo: issue.vehicleNo, field: issue.field, code: issue.code });
    const ack = byKey.get(key);
    const previous = previousByKey.get(key);
    return {
      ...issue,
      key,
      acknowledged: ack?.status === "ok",
      postponed: ack?.status === "later",
      ack: ack
        ? {
            status: ack.status,
            note: ack.note,
            ackedAt: ack.ackedAt.getTime(),
            ackedByName: ack.ackedByName,
          }
        : null,
      // 今月すでに判断済みのものに先月の話を重ねても意味がないので、未判断のときだけ出す。
      carriedOver:
        ack === undefined && previous !== undefined && canCarryOver(previous.valueAtAck, issue.value)
          ? {
              previousValue: previous.valueAtAck,
              ackedByName: previous.ackedByName,
              ackedAt: previous.ackedAt.getTime(),
            }
          : null,
    };
  });
}

/** まだ「このままでよい」と決めていない指摘 (セルの色と残り件数はこちらで決める)。 */
export function openIssues(issues: readonly ReviewedIssue[]): ReviewedIssue[] {
  return issues.filter((issue) => !issue.acknowledged);
}

/** 「あとで見る」にしたまま残っている指摘。 */
export function postponedIssues(issues: readonly ReviewedIssue[]): ReviewedIssue[] {
  return issues.filter((issue) => issue.postponed);
}

/** まだ何も判断していない指摘 (最初に確認をはじめる対象)。 */
export function untouchedIssues(issues: readonly ReviewedIssue[]): ReviewedIssue[] {
  return issues.filter((issue) => !issue.acknowledged && !issue.postponed);
}
