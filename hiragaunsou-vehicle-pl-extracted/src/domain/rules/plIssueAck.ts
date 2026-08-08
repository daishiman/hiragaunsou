/**
 * 収支表の指摘に対する「確認しました。このままでよい」の印。
 *
 * 指摘 (VehiclePlIssue) は収支表と各マスタから表示のたびに導出されるので、
 * 指摘そのものにIDを持たせられない。代わりに指摘を一意に指す4つ組
 * (年月・車番・列・指摘の種類) をキーにして、確認済みの印だけを別に保存する。
 *
 * この設計だと、確認済みにした後で値が変わって指摘が消えれば、印は自然に画面から消える
 * (キーの指す指摘が存在しなくなるだけで、印の消し込み処理は要らない)。
 * 逆に指摘が残っていれば印も残る。「値が1円でも動いたら確認済みを外す」ようにはしない。
 * 丸めの修正でも確認作業が振り出しに戻り、確認が終わらなくなるため。
 *
 * Domain層: フレームワーク非依存。
 */

import type { ReviewIssueCode, VehiclePlIssue } from "./vehiclePlReview";

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

/** 保存済みの確認済みの印 (誰がいつ確認したかを画面に出すため監査情報を併せて持つ)。 */
export interface PlIssueAckRecord extends PlIssueAckKey {
  note: string | null;
  ackedAt: Date;
  ackedByName: string | null;
}

/** 画面に渡す指摘。導出した指摘に、確認済みかどうかを重ねたもの。 */
export interface ReviewedIssue extends VehiclePlIssue {
  /** 確認済みの登録・取消に使うキー */
  key: string;
  acknowledged: boolean;
  ack: { note: string | null; ackedAt: number; ackedByName: string | null } | null;
}

/**
 * 導出した指摘に確認済みの印を重ねる。
 * 印が付いていない指摘だけが「残りの確認件数」になる。
 */
export function applyIssueAcks(
  issues: readonly VehiclePlIssue[],
  acks: readonly PlIssueAckRecord[],
): ReviewedIssue[] {
  const byKey = new Map(acks.map((ack) => [plIssueKey(ack), ack]));
  return issues.map((issue) => {
    const ack = byKey.get(plIssueKey({ vehicleNo: issue.vehicleNo, field: issue.field, code: issue.code }));
    return {
      ...issue,
      key: plIssueKey({ vehicleNo: issue.vehicleNo, field: issue.field, code: issue.code }),
      acknowledged: ack !== undefined,
      ack: ack
        ? { note: ack.note, ackedAt: ack.ackedAt.getTime(), ackedByName: ack.ackedByName }
        : null,
    };
  });
}

/** まだ確認していない指摘だけを取り出す (セルの色と残り件数はこちらで決める)。 */
export function openIssues(issues: readonly ReviewedIssue[]): ReviewedIssue[] {
  return issues.filter((issue) => !issue.acknowledged);
}
