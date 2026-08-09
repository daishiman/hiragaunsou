import { parseAmountInput } from "../../_lib/numberEntry";

/**
 * 「一覧を直してまとめて保存する」画面の共通の土台 — 項目の宣言。
 *
 * ■ なぜ宣言で書くのか
 * 率マスタ・車両マスタ・運転者マスタは、どれも「並んでいる行の一部を直して保存する」という
 * 同じ作業なのに、画面ごとに別々の入力欄・別々の保存処理を書いていた。そのため
 * 「変更した箇所を色で出す」「まとめて保存する」のような直しを1つ入れるだけで3画面を
 * 書き換えることになり、直すたびに作法がずれていった。
 *
 * ここでは項目を「名前・種類・単位・元の値の取り出し方」の宣言データとして書く。
 * 画面が用意するのは宣言と保存の宛先だけで、入力欄・差分表示・未保存件数・離脱の確認は
 * 共通部品が受け持つ。マスタに項目が増えたときは、この宣言を1行足すだけで済む。
 */

/**
 * 項目の種類。入力欄の見た目と、変更したかどうかの見分け方がこれで決まる。
 * - text   … 文字 (車種名・氏名)
 * - yen    … 金額 (保険料・税・リース料)。桁区切りで読み合わせる
 * - number … 単位付きの数 (率の%・単価)。桁区切りはしない
 * - select … 決まった選択肢 (けん引先・乗っている車)
 */
export type EditableFieldKind = "text" | "yen" | "number" | "select";

export interface EditableSelectOption {
  value: string;
  label: string;
}

export interface EditableFieldDef<TRecord> {
  /** 保存するときの項目名 (APIに送るキー) */
  field: string;
  /** 画面と読み上げに出す項目名 */
  label: string;
  kind: EditableFieldKind;
  /** 欄の後ろに出す単位 (円・%・円/ℓ) */
  unit?: string;
  /** いま保存されている値の取り出し方。null は「値なし」 */
  read: (record: TRecord) => string | null;
  /** kind === "select" のときの選択肢。行ごとに変わる (けん引先は自分自身を除く) */
  options?: (record: TRecord) => readonly EditableSelectOption[];
  /** 空のまま保存できないか。既定は空も許す */
  required?: boolean;
  /** 値が空のときに「元 ○○」で出す言葉 */
  emptyText?: string;
  widthClass?: string;
  /** 欄の下に添える短い補足 */
  hint?: string;
}

/**
 * 変更したかどうかを見分けるための、値の揃え方。
 *
 * 見た目の文字列をそのまま比べると「1,200」と「1200」、「 300 」と「300」が
 * 別の値になり、直していないのに「変更」と出てしまう。数として読める種類は数に直してから比べる。
 * 数として読めない文字は、元の値と必ず違う扱いにして保存前に気づけるようにする。
 */
export function normalizeFieldValue(kind: EditableFieldKind, raw: string | null): string {
  if (raw === null || raw === undefined) return "";
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (kind === "text" || kind === "select") return trimmed;
  const parsed = parseAmountInput(trimmed);
  return parsed === null ? `読めない値:${trimmed}` : String(parsed);
}

/** 打った値が、いまの値と違うか */
export function isFieldChanged(
  kind: EditableFieldKind,
  original: string | null,
  draft: string | null | undefined,
): boolean {
  if (draft === null || draft === undefined) return false;
  return normalizeFieldValue(kind, draft) !== normalizeFieldValue(kind, original);
}

/** 数として読めない値か (保存を止めるかどうかの判定に使う) */
export function isUnreadableNumber(kind: EditableFieldKind, raw: string): boolean {
  if (kind === "text" || kind === "select") return false;
  if (raw.trim() === "") return false;
  return parseAmountInput(raw) === null;
}

/** 画面に出すときの整え方。金額だけ桁区切りにする (桁の間違いは区切りが無いと気づけない) */
export function formatFieldValue(kind: EditableFieldKind, raw: string | null): string {
  if (raw === null || raw.trim() === "") return "";
  if (kind === "yen") {
    const parsed = parseAmountInput(raw);
    return parsed === null ? raw : parsed.toLocaleString("ja-JP");
  }
  return raw;
}

/** 保存するときに送る形。数の項目は数字だけの文字列にして送る */
export function toSubmitValue(kind: EditableFieldKind, raw: string): string {
  if (kind === "text" || kind === "select") return raw.trim();
  const parsed = parseAmountInput(raw);
  return parsed === null ? raw.trim() : String(parsed);
}
