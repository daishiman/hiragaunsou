"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HelpDrawer } from "../../../_components/HelpDrawer";
import { NumberEntryField } from "../../../_components/NumberEntryField";
import { parseAmountInput } from "../../../_lib/numberEntry";
import {
  OVERRIDABLE_FIELDS,
  OVERRIDABLE_FIELD_META,
  type OverridableField,
} from "../../../../src/domain/rules/vehiclePlOverride";

export interface OverrideEditorProps {
  yearMonth: string;
  vehicleNo: string;
  /**
   * いま収支表に載っている値。上書き済みの項目はその結果が入っている
   * (収支表は上書きを重ねてから計算されるため、素の値は保持していない)。
   */
  currentValues: Partial<Record<OverridableField, number | null>>;
  saved: {
    excluded: boolean;
    values: Partial<Record<OverridableField, number>>;
    reason: string;
    updatedAt: string | null;
    updatedByName: string | null;
  } | null;
}

/** 数値の入力欄は空文字を「上書きしない」として扱う (0 と区別する)。 */
type Draft = Partial<Record<OverridableField, string>>;

function toDraft(values: Partial<Record<OverridableField, number>>): Draft {
  const draft: Draft = {};
  for (const field of OVERRIDABLE_FIELDS) {
    const value = values[field];
    if (typeof value === "number") draft[field] = String(value);
  }
  return draft;
}

/**
 * 車両単位の最終上書き。
 *
 * いま表に載っている値と、これから入れる値を必ず並べて出す。どちらが正しいかは
 * 請求書を見た人にしか決められないので、画面は判断材料を並べるところまでを受け持つ。
 *
 * 「収支表から外す」を使うとその車両の行自体が消えるため、この編集欄は
 * 行が存在しない場合でも出す必要がある (出さないと外した車両を元に戻せなくなる)。
 */
export function VehiclePlOverrideEditor({
  yearMonth,
  vehicleNo,
  currentValues,
  saved,
}: OverrideEditorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(saved !== null);
  const [draft, setDraft] = useState<Draft>(toDraft(saved?.values ?? {}));
  const [excluded, setExcluded] = useState(saved?.excluded ?? false);
  const [reason, setReason] = useState(saved?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editedFields = OVERRIDABLE_FIELDS.filter((f) => (draft[f] ?? "") !== "");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const values: Record<string, number> = {};
      for (const field of editedFields) {
        // 読み取り規則は全画面共通 (カンマ・全角数字も受ける)。読めない欄は上書きしない。
        const parsed = parseAmountInput(draft[field] ?? "");
        if (parsed !== null) values[field] = parsed;
      }
      const res = await fetch("/api/vehicle-pl/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth, vehicleNo, excluded, values, reason }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "上書きの保存に失敗しました");
        return;
      }
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/vehicle-pl/override?yearMonth=${encodeURIComponent(yearMonth)}&vehicleNo=${encodeURIComponent(vehicleNo)}`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "上書きの取り消しに失敗しました");
        return;
      }
      setDraft({});
      setExcluded(false);
      setReason("");
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-ink">この車両だけ数字を直す</h2>
          {/*
            使い方の説明は、直すと決めた人だけが読めばよい。常時出すと、数字を見に来ただけの人にも
            毎回3行が挟まる。文章はそのままに「?」の中へ移した。
          */}
          <HelpDrawer title="この車両だけ数字を直す" label="この機能について">
            <p>
              請求側の事情でCSVの値と実態がずれる月に使います。直せるのは計算の入口の値だけで、
              損益・経費計・各小計は必ずここから計算し直されます。
              欄には、いま収支表に載っている値が薄い文字で入っています(上書き済みの項目はその結果です)。
              薄いままの欄は直したことになりません。直した欄だけが濃い文字になり、上書きとして保存されます。
            </p>
          </HelpDrawer>
        </div>
        {saved ? (
          <span className="rounded-full border border-caution-border bg-caution-soft px-2.5 py-0.5 text-[11px] font-semibold text-ink">
            上書きあり
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-brand-deep hover:underline"
          >
            {open ? "閉じる" : "直す"}
          </button>
        )}
      </div>
      {saved ? (
        <p className="mt-2 rounded-md border border-line bg-subtle px-3 py-2 text-[11px] leading-relaxed text-ink">
          <span className="font-semibold">理由:</span> {saved.reason}
          {saved.updatedByName ? (
            <span className="ml-2 text-ink-muted">
              ({saved.updatedByName}
              {saved.updatedAt ? ` / ${new Date(saved.updatedAt).toLocaleString("ja-JP")}` : ""})
            </span>
          ) : null}
        </p>
      ) : null}

      {open ? (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="data-table min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3">項目</th>
                  <th className="py-2 pr-3">出どころ</th>
                  {/* いまの値は欄の中に薄く入っているので、同じ数字を左にも並べない */}
                  <th className="py-2">値(直すとここが変わります)</th>
                </tr>
              </thead>
              <tbody>
                {OVERRIDABLE_FIELDS.map((field) => {
                  const meta = OVERRIDABLE_FIELD_META[field];
                  const current = currentValues[field];
                  const overridden = saved?.values[field] !== undefined;
                  return (
                    <tr key={field} className="border-b border-line last:border-b-0">
                      <td className="py-2 pr-3 font-medium text-ink">{meta.label}</td>
                      <td className="py-2 pr-3 text-[11px] text-ink-muted">
                        {overridden ? "上書き済み" : meta.source}
                      </td>
                      <td className="py-2">
                        <NumberEntryField
                          value={draft[field] ?? ""}
                          onChange={(raw) => setDraft((d) => ({ ...d, [field]: raw }))}
                          autoValue={typeof current === "number" ? current : null}
                          autoLabel="いまの値"
                          ariaLabel={`${meta.label}(${meta.unit})`}
                          disabled={busy || excluded}
                          widthClass="w-36"
                        />
                        <span className="ml-1 text-[11px] text-ink-muted">{meta.unit}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <label className="mt-4 flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={excluded}
              disabled={busy}
              onChange={(e) => setExcluded(e.target.checked)}
            />
            この車両を今月の収支表に載せない(行ごと外す)
          </label>

          <label className="mt-3 block text-xs text-ink">
            <span className="font-semibold">直した理由(必須)</span>
            <textarea
              rows={2}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: 5月分の運賃を請求側で15万円減額したため"
              className="mt-1 block w-full rounded-md border border-line px-2 py-1.5 text-sm"
            />
            <span className="mt-1 block text-[11px] text-ink-muted">
              翌月に同じ手直しをするか判断するために残します。
            </span>
          </label>

          {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || (!excluded && editedFields.length === 0)}
              onClick={() => void save()}
              className="btn btn-primary pressable"
            >
              {busy ? "保存して再計算しています…" : "保存して収支表を作り直す"}
            </button>
            {saved ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void clear()}
                className="btn btn-quiet pressable"
              >
                上書きを取り消して元に戻す
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
