/**
 * 手入力の数値欄で共通に使う読み取り規則。
 *
 * もともと画面ごとに parseSumExpression / parseYen / toNumber と別々の実装があり、
 * 同じ「1,200」でも画面によって通ったり弾かれたりしていた。読み取り規則は
 * 業務の言葉 (いくらか) の解釈そのものなので、画面ごとに違ってはいけない。
 *
 * 入力には寛容に、保存には厳格に (ポステルの法則)。全角数字・カンマ・空白・
 * 円記号が混ざっていても受け、数字として読めないときだけ null を返して確定させない。
 */

/** 全角数字・全角記号を半角に落とし、桁区切りと単位を落とす */
function normalizeDigits(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/＋/g, "+")
    .replace(/．/g, ".")
    .replace(/[,，、\s¥￥]/g, "")
    .replace(/円$/u, "");
}

/**
 * 「1200+340+560」のような足し算式を受け付けて合計を返す。
 *
 * 業務フロー STEP6 の「請求書に割引額の合計が載っていないため個別の割引額を合算する」に対応する。
 * 電卓に持ち替えずその場で足せることが目的。数値として読めないときは null を返し、確定させない。
 */
export function parseAmountInput(raw: string): number | null {
  const normalized = normalizeDigits(raw);
  if (normalized === "") return null;
  if (!/^[0-9.+]+$/.test(normalized)) return null;
  const parts = normalized.split("+").filter((p) => p !== "");
  if (parts.length === 0) return null;
  let sum = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n)) return null;
    sum += n;
  }
  return sum;
}

/**
 * 請求書のExcelから「車番 金額」を範囲コピーして貼り付けた文字列を行に分解する。
 *
 * 元のExcel業務が「ピボットの結果を範囲コピーして貼る」だったので、同じ操作を残す。
 * 区切りはタブ優先。金額の桁区切りカンマを壊さないため、カンマでは分割しない。
 */
export interface PastedRow {
  vehicleNo: string;
  values: string[];
}

export function parsePastedRows(text: string): PastedRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const cells = (line.includes("\t") ? line.split("\t") : line.split(/[\s、]+/)).map((c) =>
        c.trim(),
      );
      return { vehicleNo: cells[0] ?? "", values: cells.slice(1) };
    })
    .filter((row) => row.vehicleNo !== "" && row.values.length > 0);
}

/**
 * 共通の数値入力欄に付ける目印。
 * Enterでの移動先はこの目印を頼りに探すので、画面ごとに別の属性名を使わない。
 */
export const ENTRY_FIELD_ATTR = "data-entry-field";

/**
 * IME確定中のEnterでは送らず、通常のEnterは次の欄へ移動する(誤送信防止)。
 *
 * 表の中では「同じ列の次の行」へ進む。請求書は1種類の金額が縦に並んでいるので、
 * 紙を上から順に読みながら1列を打ち切れる。列の最後まで来たら次の列の先頭へ折り返す。
 * data-col が無い欄 (表ではない単独の欄) は、単に次の欄へ進む。
 */
export function moveFocusOnEnter(e: React.KeyboardEvent<HTMLInputElement>): void {
  if (e.key !== "Enter") return;
  if (e.nativeEvent.isComposing) return;
  e.preventDefault();
  // form の外でも使えるように、form が無ければ画面全体から探す。
  const scope: HTMLFormElement | Document = e.currentTarget.form ?? e.currentTarget.ownerDocument;
  const inputs = Array.from(
    scope.querySelectorAll<HTMLInputElement>(`input[${ENTRY_FIELD_ATTR}]`),
  ).filter((el) => !el.disabled);
  const col = e.currentTarget.dataset.col;
  if (col === undefined) {
    const next = inputs[inputs.indexOf(e.currentTarget) + 1];
    if (next) next.focus();
    return;
  }
  const sameColumn = inputs.filter((el) => el.dataset.col === col);
  const nextInColumn = sameColumn[sameColumn.indexOf(e.currentTarget) + 1];
  if (nextInColumn) {
    nextInColumn.focus();
    return;
  }
  const nextColumn = inputs.find((el) => el.dataset.col === String(Number(col) + 1));
  if (nextColumn) nextColumn.focus();
}
