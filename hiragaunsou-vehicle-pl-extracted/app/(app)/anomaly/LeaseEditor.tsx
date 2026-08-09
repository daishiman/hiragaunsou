"use client";

import { useMemo, useState } from "react";
import { NumberEntryField } from "../../_components/NumberEntryField";
import { num } from "../../_lib/format";

export interface LeaseEditorRow {
  vehicleNo: string;
  vehicleType: string;
  lease: number;
  installment: number;
}

/** 全角数字・カンマ・円記号を受けても通す (入力に寛容・保存時に厳格) */
function toNumber(raw: string): number | null {
  const half = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，¥￥\s]/g, "");
  if (half === "") return 0;
  const n = Number(half);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * 業務フロー STEP7「リース料・割賦支払額の変更を都度修正する」。
 *
 * 収支表のセルを直接いじらせず、車両マスタを直して収支表を作り直す。
 * 変更のあった車両だけを触る想定なので、検索で1台に絞ってから直す形にしている。
 */
export function LeaseEditor({
  rows,
  yearMonth,
  canEdit,
}: {
  rows: LeaseEditorRow[];
  yearMonth: string;
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, { lease: string; installment: string }>>(() =>
    Object.fromEntries(
      rows.map((r) => [r.vehicleNo, { lease: String(r.lease), installment: String(r.installment) }]),
    ),
  );
  const [savingNo, setSavingNo] = useState<string | null>(null);
  const [savedNo, setSavedNo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (q === "") return rows;
    return rows.filter((r) => r.vehicleNo.includes(q) || r.vehicleType.includes(q));
  }, [rows, query]);

  const changed = (r: LeaseEditorRow): boolean => {
    const v = values[r.vehicleNo];
    if (!v) return false;
    return toNumber(v.lease) !== r.lease || toNumber(v.installment) !== r.installment;
  };

  async function save(r: LeaseEditorRow) {
    const v = values[r.vehicleNo];
    if (!v) return;
    const lease = toNumber(v.lease);
    const installment = toNumber(v.installment);
    if (lease === null || installment === null) {
      setError(`車番 ${r.vehicleNo}: 金額は0以上の数字で入力してください`);
      return;
    }
    setSavingNo(r.vehicleNo);
    setError(null);
    try {
      const res = await fetch("/api/vehicle-master/lease", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ yearMonth, vehicleNo: r.vehicleNo, lease, installment }),
      });
      if (!res.ok) throw new Error(`保存できませんでした (HTTP ${res.status})`);
      r.lease = lease;
      r.installment = installment;
      setSavedNo(r.vehicleNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSavingNo(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <section className="mt-4 rounded-xl border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-5 py-3 text-left"
      >
        <span className="text-sm font-bold text-ink">リース料・割賦支払額を直す</span>
        <span className="text-xs text-ink-muted">
          契約の変更があった車両だけ直します。直すと収支表が作り直されます。
        </span>
        <span className="ml-auto text-xs font-semibold text-brand-deep">
          {open ? "閉じる" : "開く"}
        </span>
      </button>

      {open && (
        <div className="border-t border-line px-5 py-4">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="車番や車種で絞り込む(例: 24)"
            className="w-full max-w-xs rounded-md border border-line bg-white px-3 py-2 text-sm"
          />

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-line text-xs font-medium text-ink-muted">
                  <th className="px-2 py-2 text-left">車番</th>
                  <th className="px-2 py-2 text-left">車種</th>
                  <th className="px-2 py-2 text-right">リース料(円)</th>
                  <th className="px-2 py-2 text-right">割賦支払額(円)</th>
                  <th className="px-2 py-2 text-right">保存</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const v = values[r.vehicleNo] ?? { lease: "", installment: "" };
                  const dirty = changed(r);
                  return (
                    <tr key={r.vehicleNo} className="border-b border-line last:border-b-0">
                      <td className="num px-2 py-2 font-semibold">{r.vehicleNo}</td>
                      <td className="px-2 py-2 text-ink-muted">{r.vehicleType}</td>
                      {(
                        [
                          { key: "lease", label: "リース料" },
                          { key: "installment", label: "割賦支払額" },
                        ] as const
                      ).map(({ key, label }, colIndex) => {
                        // 共通部品は「人が触っていない = 空文字」で持つ。
                        // ここは常に実額を保存するので、いまの値と同じなら空文字として渡す。
                        const currentRaw = String(r[key]);
                        return (
                          <td key={key} className="px-2 py-1.5 text-right">
                            <NumberEntryField
                              value={v[key] === currentRaw ? "" : v[key]}
                              onChange={(raw) =>
                                setValues((prev) => ({
                                  ...prev,
                                  [r.vehicleNo]: { ...v, [key]: raw === "" ? currentRaw : raw },
                                }))
                              }
                              autoValue={r[key]}
                              autoLabel="いまの値"
                              ariaLabel={`${r.vehicleNo}番の${label}(円)`}
                              disabled={!canEdit}
                              col={colIndex}
                              widthClass="w-28"
                            />
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right">
                        {savedNo === r.vehicleNo && !dirty ? (
                          <span className="text-xs text-ink-muted">保存済み</span>
                        ) : (
                          <button
                            type="button"
                            disabled={!canEdit || !dirty || savingNo === r.vehicleNo}
                            onClick={() => save(r)}
                            className="pressable rounded-md border border-brand px-3 py-1 text-xs font-semibold text-brand-deep hover:bg-brand-soft disabled:border-line disabled:text-ink-muted disabled:opacity-60"
                          >
                            {savingNo === r.vehicleNo ? "保存中…" : "保存する"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <p className="mt-3 text-xs text-ink-muted">
              「{query}」に一致する車両はありません。
            </p>
          )}

          {!canEdit && (
            <p className="mt-3 rounded-md border border-caution-border bg-caution-soft px-3 py-2 text-xs text-ink">
              金額を直すには入力権限が必要です。閲覧のみ可能です。
            </p>
          )}

          {error && (
            <p className="mt-3 rounded-md border border-danger px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          <p className="mt-3 text-[11px] text-ink-muted">
            合計 リース料 {num(rows.reduce((s, r) => s + r.lease, 0))} 円 / 割賦{" "}
            {num(rows.reduce((s, r) => s + r.installment, 0))} 円
          </p>
        </div>
      )}
    </section>
  );
}
