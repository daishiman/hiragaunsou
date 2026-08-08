"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
        values[field] = Number(draft[field]);
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
    <section className="mt-5 rounded-xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">この車両だけ数字を直す</h2>
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
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        請求側の事情でCSVの値と実態がずれる月に使います。直せるのは計算の入口の値だけで、
        損益・経費計・各小計は必ずここから計算し直されます。
        左の列はいま収支表に載っている値です(上書き済みの項目はその結果が出ます)。
      </p>

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
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3">項目</th>
                  <th className="py-2 pr-3">いまの収支表の値(出どころ)</th>
                  <th className="py-2">上書きする値</th>
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
                      <td className="num py-2 pr-3 text-ink-muted">
                        {typeof current === "number" ? current.toLocaleString("ja-JP") : "—"}
                        <span className="ml-2 text-[11px]">
                          {overridden ? "上書き済み" : meta.source}
                        </span>
                      </td>
                      <td className="py-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          disabled={busy || excluded}
                          value={draft[field] ?? ""}
                          placeholder="直さない"
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [field]: e.target.value }))
                          }
                          className="num w-36 rounded-md border border-line px-2 py-1 text-right text-sm disabled:bg-subtle"
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
              className="pressable rounded-md bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-50"
            >
              {busy ? "保存して再計算しています…" : "保存して収支表を作り直す"}
            </button>
            {saved ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void clear()}
                className="pressable rounded-md border border-line bg-white px-5 py-2 text-sm text-ink hover:bg-subtle disabled:opacity-50"
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
