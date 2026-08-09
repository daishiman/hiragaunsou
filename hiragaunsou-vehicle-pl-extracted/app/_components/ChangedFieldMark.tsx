"use client";

import type { ReactNode } from "react";

/**
 * 「この欄はまだ保存していない変更です」を出すための共通の見た目。
 *
 * ■ なぜ1箇所にまとめるか
 * 直した箇所が分かる表現を画面ごとに作ると、手入力画面では薄い色、マスタ画面では太字…と
 * 画面ごとに読み方が変わる。どの画面でも「変更した欄は同じ見た目」であることが、
 * まとめて保存する作りの前提になる(保存を押す前に、何を変えたのかを目で数えられること)。
 *
 * ■ 決めた表し方 (全ての欄で同じ)
 * 1. 欄そのものを操作色 (brand) の枠 + 薄い操作色の面にする。
 * 2. 欄の左に「変更」の札を出す。色だけに頼らない (色覚特性・白黒印刷・老眼)。
 * 3. 欄の下に「元 ○○」と元の値を併記する。何をどう変えたかが1行で読める。
 * 4. 元に戻す入口を必ず添える (「いまの値に戻す」「取込値に戻す」)。
 *
 * 色は docs/design-system.md のトークンだけを使う。変更は「操作の結果」なので
 * ブランド色(操作・選択状態)の役割に収まる。新しい色相は増やさない。
 */

/** 変更済みの入力欄に足すクラス。未変更の欄は border-line / bg-white のまま。 */
export const CHANGED_FIELD_CLASS = "border-brand bg-brand-soft font-semibold text-ink";

/** 変更した欄に付ける札。文字を必ず持たせる (色だけで状態を伝えない)。 */
export function ChangedFieldBadge({ label = "変更" }: { label?: string }) {
  return (
    <span className="shrink-0 rounded bg-brand-soft px-1 text-[10px] font-semibold whitespace-nowrap text-brand-deep">
      {label}
    </span>
  );
}

/**
 * 欄の下に出す「元の値」。
 * 変更後の数字だけを見ても、桁を1つ間違えたことには気づけない。元の値を並べて初めて気づける。
 */
export function OriginalValueNote({
  original,
  emptyText = "空欄",
}: {
  /** 直す前の値。数字は呼び出し側で桁区切りにしてから渡す */
  original: ReactNode;
  emptyText?: string;
}) {
  const shown =
    original === null || original === undefined || original === "" ? emptyText : original;
  return (
    <span className="whitespace-nowrap text-ink-muted">
      元 <span className="num">{shown}</span>
    </span>
  );
}

/**
 * 一覧を読む状態(入力欄ではない状態)で、変更済みの値を出すときの表示。
 * フォームを閉じても「どこを変えたか」が消えないようにする。
 */
export function ChangedValueText({
  value,
  original,
  emptyText = "空欄",
}: {
  value: ReactNode;
  original: ReactNode;
  emptyText?: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1">
      <span className="rounded bg-brand-soft px-1 font-semibold text-ink">
        {value === null || value === undefined || value === "" ? emptyText : value}
      </span>
      <ChangedFieldBadge />
      <span className="text-[11px]">
        <OriginalValueNote original={original} emptyText={emptyText} />
      </span>
    </span>
  );
}
