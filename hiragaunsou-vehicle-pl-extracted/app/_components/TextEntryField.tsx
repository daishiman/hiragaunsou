"use client";

import { ENTRY_FIELD_ATTR, moveFocusOnEnter } from "../_lib/numberEntry";
import { CHANGED_FIELD_CLASS, ChangedFieldBadge, OriginalValueNote } from "./ChangedFieldMark";

/**
 * 文字を手で入れる欄。全画面共通。
 *
 * 数字の欄 (NumberEntryField) と作法を完全に揃える。マスタの1行には車種名のような文字と
 * 保険料のような金額が並ぶので、同じ行の中で欄の読み方が変わると
 * 「この欄は空欄のままでいいのか」を欄ごとに考え直すことになる。
 *
 * ■ 作法 (NumberEntryField と同じ)
 * 1. いまの値は欄の中に薄い文字で入れる。欄の外に別表示しない。
 * 2. 触っていない欄には「いまの値」の札を出す。
 * 3. 打ち替えると操作色の枠になり、「変更」の札と「元 ○○」、そして戻す入口が出る。
 * 4. Enterで次の欄へ進む。IME確定中のEnterでは進まない。
 *
 * ■ 「触っていない」を null で持つ理由
 * 数字の欄は空文字を「触っていない」として扱うが、マスタの文字欄は
 * 「車番を空にして未割当に戻す」という直しが業務上ありうる。空文字を触っていない扱いにすると
 * 空にする手段が無くなるので、この欄だけ null(触っていない) と ""(空にした) を分けて持つ。
 */
export function TextEntryField({
  draft,
  onChange,
  currentValue,
  currentLabel = "いまの値",
  ariaLabel,
  placeholder,
  emptyText = "未入力",
  disabled = false,
  col,
  widthClass = "w-32",
}: {
  /** 人が打った文字。null なら触っていない */
  draft: string | null;
  onChange: (next: string | null) => void;
  /** 保存されているいまの値 */
  currentValue: string | null;
  currentLabel?: string;
  ariaLabel: string;
  placeholder?: string;
  /** 値が空のときに「元 ○○」で出す文字 */
  emptyText?: string;
  disabled?: boolean;
  col?: number;
  widthClass?: string;
}) {
  const current = currentValue ?? "";
  const touched = draft !== null;
  const display = touched ? draft : current;
  /** 打ち替えた結果が元と同じなら、変更として数えない (保存対象にもしない) */
  const isChanged = touched && draft !== current;

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className="flex items-center gap-1.5">
        {isChanged ? <ChangedFieldBadge /> : null}
        {!touched && current !== "" ? (
          <span className="shrink-0 rounded bg-subtle px-1 text-[10px] font-semibold whitespace-nowrap text-ink-muted">
            {currentLabel}
          </span>
        ) : null}
        <input
          {...{ [ENTRY_FIELD_ATTR]: "" }}
          data-col={col}
          type="text"
          disabled={disabled}
          /* 読み上げでも「いまの値のまま」「変更した」が分かるようにする */
          aria-label={
            isChanged
              ? `${ariaLabel}(変更しました。元は${current === "" ? emptyText : current})`
              : touched
                ? ariaLabel
                : `${ariaLabel}(${currentLabel}です)`
          }
          value={display}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={moveFocusOnEnter}
          className={[
            "rounded-md border px-2 py-1 text-sm",
            widthClass,
            isChanged
              ? CHANGED_FIELD_CLASS
              : `border-line ${touched ? "text-ink" : "text-ink-muted"}`,
            disabled ? "bg-subtle" : isChanged ? "" : "bg-white",
          ].join(" ")}
        />
      </span>

      {/* 元の値と戻す入口。高さを常に確保して、打つたびに行がずれないようにする */}
      <span className="flex min-h-[1.0625rem] items-center gap-1.5 text-[11px] leading-none">
        {isChanged ? (
          <>
            <OriginalValueNote original={current} emptyText={emptyText} />
            {!disabled ? (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="rounded px-1 font-semibold text-brand-deep underline underline-offset-2 hover:bg-brand-soft"
              >
                {currentLabel}に戻す
              </button>
            ) : null}
          </>
        ) : null}
      </span>
    </span>
  );
}
