"use client";

import { useState } from "react";
import { currentYearMonth, selectableYearMonths } from "../_lib/yearMonth";

type SourceType = "vehicle_operation" | "sales_monitor" | "payroll";

const SOURCES: { type: SourceType; label: string; desc: string }[] = [
  { type: "vehicle_operation", label: "車両別運行実績表", desc: "デジタコ/ITP-WEBServiceV3の出力" },
  { type: "sales_monitor", label: "売上モニタリスト", desc: "車楽クラウドの出力" },
  { type: "payroll", label: "給与集計表", desc: "ACELINK NX-CE(日給者)の出力" },
];

type Result =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string };

export function ImportForm() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [pending, setPending] = useState<SourceType | null>(null);
  const [results, setResults] = useState<Partial<Record<SourceType, Result>>>({});

  async function handleUpload(sourceType: SourceType, file: File) {
    setPending(sourceType);
    const form = new FormData();
    form.append("file", file);
    form.append("yearMonth", yearMonth);
    try {
      const res = await fetch(`/api/import/${sourceType}`, { method: "POST", body: form });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setResults((prev) => ({ ...prev, [sourceType]: { ok: false, message: String(data.error ?? "取込に失敗しました") } }));
      } else {
        setResults((prev) => ({ ...prev, [sourceType]: { ok: true, data } }));
      }
    } catch {
      setResults((prev) => ({ ...prev, [sourceType]: { ok: false, message: "通信エラーが発生しました" } }));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <label className="flex items-center gap-2 text-xs text-ink-muted">
        対象年月
        <select
          value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)}
          className="rounded-md border border-line bg-white px-2 py-1 text-sm text-ink"
        >
          {selectableYearMonths(13).map((ym) => (
            <option key={ym} value={ym}>
              {ym}
            </option>
          ))}
        </select>
      </label>

      {SOURCES.map((source) => {
        const result = results[source.type];
        return (
          <section key={source.type} className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-bold text-ink">{source.label}</h2>
            <p className="mt-1 text-xs text-ink-muted">{source.desc}</p>

            <div className="mt-4">
              <input
                type="file"
                accept=".csv"
                disabled={pending === source.type}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(source.type, file);
                  e.target.value = "";
                }}
                className="block w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-brand file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-deep hover:file:bg-brand-soft"
              />
            </div>

            {pending === source.type ? (
              <p className="mt-3 text-xs text-ink-muted">取込中です…</p>
            ) : null}

            {result ? (
              result.ok ? (
                <div className="mt-3 grid grid-cols-[8rem_1fr] gap-2 border-t border-line pt-3 text-sm">
                  {Object.entries(result.data).map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-xs text-ink-muted">{key}</dt>
                      <dd className="num text-ink">{String(value)}</dd>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-caution-border bg-caution-soft px-4 py-3 text-xs">
                  {result.message}
                </div>
              )
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
