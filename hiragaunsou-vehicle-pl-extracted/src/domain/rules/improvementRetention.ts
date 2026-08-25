/**
 * 改善要望に付いてくる「重いもの・個人に近いもの」を、いつまで持つかの決まり。
 *
 * 対象は次の2つだけで、要望の本文と操作の記録は消さない。
 *
 *   - 画面の写し   … その人の画面がそのまま写る。1件あたり最大700KB。
 *   - 診断情報     … 直前に開いていたURL・ブラウザの種類・裏で落ちていた通信の中身。
 *
 * 本文を消さないのは、本文が「何を直すと決めたか」の記録そのものだから。
 * 消してしまうと、残課題リストや監査の記録から辿ったときに中身が分からなくなる。
 * 一方で写しと診断情報は、直し終われば読み返さない。持ち続けても増えるだけで、
 * 漏れたときの被害は本文よりずっと大きい。だから「本文は残す・付随物は落とす」に分ける。
 *
 * 数え始めは受け取った日 (createdAt)。最後に触った日ではない。
 * 「預かってから何日で捨てるか」の約束にしておくと、利用者に説明できる形になる。
 */

/** 既定の保存期間 (日)。短くしたければ IMPROVEMENT_RETENTION_DAYS で上書きする。 */
export const RETENTION_DAYS_DEFAULT = 90;

/**
 * 指定できる下限 (日)。
 * これより短くすると、届いた要望を管理者が見る前に写しが消えることが起きる。
 */
export const RETENTION_DAYS_MIN = 7;

/** 指定できる上限 (日)。1年を超えて持ち続ける理由がない。 */
export const RETENTION_DAYS_MAX = 365;

/**
 * 1回の掃除で扱う上限 (件)。
 *
 * 掃除は要望を受け取ったついでに走るので、受け取り側を待たせない量で切る。
 * 消し残した分は次に要望が届いたときに続きから消えるため、取りこぼしにはならない。
 */
export const RETENTION_SWEEP_MAX = 100;

/**
 * 設定値から保存期間を決める。
 *
 * 読めない値・範囲外の値でも止まらず既定に倒す。設定の書き間違いで
 * 「保存期間0日 = 届いた瞬間に写しが消える」が起きる方が困る。
 */
export function retentionDaysOf(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || raw.trim() === "") return RETENTION_DAYS_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return RETENTION_DAYS_DEFAULT;
  const days = Math.trunc(parsed);
  if (days < RETENTION_DAYS_MIN || days > RETENTION_DAYS_MAX) return RETENTION_DAYS_DEFAULT;
  return days;
}

/** この時刻より前に受け取ったものが、掃除の対象になる。 */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** 画面に出す一言。何が・いつ消えるのかを、消える前から分かるようにする。 */
export function retentionNoticeText(days: number): string {
  return `画面の写しと診断情報は、届いてから${days}日で自動的に消えます（要望の本文と対応の記録は残ります）。`;
}

/** 消したことを記録に残すときの一文。 */
export function retentionSweepNote(days: number): string {
  return `保存期間（${days}日）を過ぎたため、画面の写しと診断情報を消しました。本文と記録は残しています。`;
}
