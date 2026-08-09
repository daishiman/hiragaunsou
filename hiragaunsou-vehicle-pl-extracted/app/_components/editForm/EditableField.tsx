"use client";

import { memo } from "react";
import { NumberEntryField } from "../NumberEntryField";
import { TextEntryField } from "../TextEntryField";
import { CHANGED_FIELD_CLASS, ChangedFieldBadge, OriginalValueNote } from "../ChangedFieldMark";
import { parseAmountInput } from "../../_lib/numberEntry";
import { formatFieldValue, isFieldChanged, type EditableFieldDef } from "./fieldDefs";

/**
 * 「一覧を直してまとめて保存する」画面の共通の土台 — 欄1つの描画。
 *
 * 宣言 (EditableFieldDef) を渡すと、種類に合った入力欄を出す。文字・金額・選択のどれでも
 * 「いまの値が欄の中に薄く入っている / 打ち替えると操作色になり『変更』の札と元の値が出る /
 * Enterで次の欄へ進む」という同じ作法になる。画面ごとに入力欄を書き起こさない。
 */
export interface EditableFieldProps<TRecord> {
  def: EditableFieldDef<TRecord>;
  record: TRecord;
  /** 人が打った値。undefined なら触っていない */
  draft: string | undefined;
  onChange: (field: string, value: string | null) => void;
  /** 保存できなかったときの理由 */
  error?: string;
  disabled?: boolean;
  /** 表の中でEnterを押したときに、同じ列の次の行へ進むための列番号 */
  col?: number;
  ariaLabel?: string;
}

function EditableFieldInner<TRecord>({
  def,
  record,
  draft,
  onChange,
  error,
  disabled = false,
  col,
  ariaLabel,
}: EditableFieldProps<TRecord>) {
  const current = def.read(record);
  const label = ariaLabel ?? `${def.label}${def.unit ? `(${def.unit})` : ""}`;
  const emptyText = def.emptyText ?? "未入力";

  const field = (() => {
    if (def.kind === "select") {
      return (
        <SelectEntryField
          draft={draft ?? null}
          onChange={(next) => onChange(def.field, next)}
          currentValue={current}
          options={def.options?.(record) ?? []}
          ariaLabel={label}
          emptyText={emptyText}
          disabled={disabled}
          widthClass={def.widthClass}
        />
      );
    }
    if (def.kind === "text") {
      return (
        <TextEntryField
          draft={draft ?? null}
          onChange={(next) => onChange(def.field, next)}
          currentValue={current}
          ariaLabel={label}
          emptyText={emptyText}
          disabled={disabled}
          col={col}
          widthClass={def.widthClass ?? "w-32"}
        />
      );
    }
    // 金額・数の欄。空にする操作は「いまの値に戻す」と同じ意味にする
    // (金額欄を空で保存したい場面は無く、0にしたいなら0と打てる)。
    const currentNumber = current === null || current.trim() === "" ? null : parseAmountInput(current);
    return (
      <NumberEntryField
        value={draft ?? ""}
        onChange={(raw) => onChange(def.field, raw === "" ? null : raw)}
        autoValue={currentNumber}
        autoLabel="いまの値"
        ariaLabel={label}
        col={col}
        widthClass={def.widthClass ?? "w-28"}
        showEcho={def.kind === "yen"}
        hints={def.hint ? <span>{def.hint}</span> : undefined}
      />
    );
  })();

  return (
    <span className="inline-flex flex-col items-start">
      {field}
      {error ? <span className="text-[11px] leading-tight text-danger">{error}</span> : null}
    </span>
  );
}

export const EditableField = memo(EditableFieldInner) as typeof EditableFieldInner;

/**
 * 表の1行ぶんの入力欄 (td の並び)。
 *
 * 100台・80名が並ぶ表でも、打つたびに全部の行を描き直さないようにここで止める。
 * 下書きは行ごとに別の入れ物で持っているので、直していない行は同じ中身のまま届き、
 * この行は描き直されない (React.memo)。
 */
function EditableRowCellsInner<TRecord>({
  record,
  rowKey,
  fields,
  draft,
  onChange,
  fieldErrorOf,
  disabled = false,
  rowLabel,
  cellClassName = "px-3 py-2",
}: {
  record: TRecord;
  rowKey: string;
  fields: readonly EditableFieldDef<TRecord>[];
  draft: Record<string, string> | undefined;
  onChange: (rowKey: string, field: string, value: string | null) => void;
  fieldErrorOf: (rowKey: string, field: string) => string | undefined;
  disabled?: boolean;
  /** 読み上げ用の行の名前 (「車番24」「社員No1002 平田」) */
  rowLabel: string;
  cellClassName?: string;
}) {
  return (
    <>
      {fields.map((def, index) => (
        <td key={def.field} className={cellClassName}>
          <EditableField
            def={def}
            record={record}
            draft={draft?.[def.field]}
            onChange={(field, value) => onChange(rowKey, field, value)}
            error={fieldErrorOf(rowKey, def.field)}
            disabled={disabled}
            col={index}
            ariaLabel={`${rowLabel}の${def.label}${def.unit ? `(${def.unit})` : ""}`}
          />
        </td>
      ))}
    </>
  );
}

export const EditableRowCells = memo(EditableRowCellsInner) as typeof EditableRowCellsInner;

/**
 * 決まった選択肢から選ぶ欄。文字・数の欄と同じ差分表示を持たせる。
 * 選択肢の欄だけ「変えたのに色が変わらない」と、直したつもりが保存されていないのか
 * 直っていないのかが読めなくなる。
 */
export function SelectEntryField({
  draft,
  onChange,
  currentValue,
  options,
  ariaLabel,
  emptyText = "未設定",
  disabled = false,
  widthClass = "w-40",
}: {
  draft: string | null;
  onChange: (next: string | null) => void;
  currentValue: string | null;
  options: readonly { value: string; label: string }[];
  ariaLabel: string;
  emptyText?: string;
  disabled?: boolean;
  widthClass?: string;
}) {
  const current = currentValue ?? "";
  const value = draft ?? current;
  const changed = isFieldChanged("select", currentValue, draft);
  const originalLabel = options.find((o) => o.value === current)?.label ?? current;

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className="flex items-center gap-1.5">
        {changed ? <ChangedFieldBadge /> : null}
        <select
          aria-label={
            changed
              ? `${ariaLabel}(変更しました。元は${originalLabel === "" ? emptyText : originalLabel})`
              : ariaLabel
          }
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === current ? null : e.target.value)}
          className={[
            "rounded-md border px-2 py-1 text-xs",
            widthClass,
            changed ? CHANGED_FIELD_CLASS : "border-line bg-white text-ink",
            disabled ? "opacity-50" : "",
          ].join(" ")}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
      <span className="flex min-h-[1.0625rem] items-center gap-1.5 text-[11px] leading-none">
        {changed ? (
          <>
            <OriginalValueNote original={formatFieldValue("select", originalLabel)} emptyText={emptyText} />
            {!disabled ? (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="rounded px-1 font-semibold text-brand-deep underline underline-offset-2 hover:bg-brand-soft"
              >
                いまの値に戻す
              </button>
            ) : null}
          </>
        ) : null}
      </span>
    </span>
  );
}
