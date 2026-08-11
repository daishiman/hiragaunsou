/**
 * 素のフォームで使う入力欄の見た目。
 *
 * マスタの一覧編集には TextEntryField / NumberEntryField (触っていない値と直した値を
 * 見分ける仕掛け付き) があるが、自分の設定・利用者の追加・AIの設定のような
 * 「ただ打つだけ」の欄はその仕掛けが要らない。そこで同じクラス文字列が
 * 16箇所に写し取られていた。写しがあると、片方だけ直って欄の高さが揃わなくなる。
 *
 * 見た目の定義はここ1箇所。画面の中にこのクラス列を書き写さない。
 */

/** 文字・数字を打つ欄、選ぶ欄に共通のクラス */
export const FIELD_CLASS =
  "rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink disabled:bg-subtle disabled:text-ink-muted";

/** 幅いっぱいに広げる欄 */
export const FIELD_BLOCK_CLASS = `${FIELD_CLASS} w-full`;

/** 欄の上に置く項目名 */
export const FIELD_LABEL_CLASS = "block text-xs font-semibold text-ink-muted";

/**
 * ファイルを選ぶ欄。
 * ボタン部分の見た目はブラウザ既定のままだと OS ごとに違う顔になるので、
 * file セレクタで .btn と同じ寸法に揃える。
 */
export const FILE_FIELD_CLASS =
  "block w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-subtle file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink hover:file:bg-brand-soft";
