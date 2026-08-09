/**
 * 「保存していない変更があるまま、画面を離れようとしたとき」の共通の関所。
 *
 * 対象年月の切り替えは共通の部品 (YearMonthSelect) が持っているのに対し、
 * 保存していないかどうかを知っているのは画面側の編集フォームである。両者を直接つなぐと、
 * 年月の部品が画面ごとの都合を知ることになる。間にこの関所を1つ置き、
 * 編集フォームが「いま離れてよいか」を登録し、離れる側は登録があれば必ず尋ねる形にする。
 *
 * 登録が無いときは何も起きない (これまで通り即座に移動する)。
 */

/** 離れてよければ true。false を返した側が確認の画面を出す責任を持つ。 */
export type LeaveGuard = (proceed: () => void) => boolean;

let currentGuard: LeaveGuard | null = null;

/** 編集フォームが登録する。画面を離れるときは null に戻す。 */
export function setLeaveGuard(guard: LeaveGuard | null): void {
  currentGuard = guard;
}

/**
 * 画面を離れる操作 (対象年月の切り替えなど) はここを通す。
 * 実際に離れたときだけ true を返す。false のときは呼び出し側の見た目を元へ戻すこと。
 */
export function requestLeave(proceed: () => void): boolean {
  if (currentGuard === null) {
    proceed();
    return true;
  }
  return currentGuard(proceed);
}
