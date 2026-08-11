"use client";

import { useMemo, useState } from "react";
import { NumberEntryField } from "../../_components/NumberEntryField";
import { AlertPanel } from "../../_components/AlertPanel";
import { DataTable } from "../../_components/DataTable";
import { FIELD_CLASS } from "../../_components/formStyles";
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
    <section className="mt-4 card">
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
            placeholder="車番や車種で絞り込む（例: 24）"
            aria-label="車番や車種で絞り込む"
            className={`${FIELD_CLASS} max-w-xs`}
          />

          <div className="mt-3">
            {/*
              表かカードか (T7 §4-1)。ここは「どの車両のリース料がいくらか」を
              台どうしで見比べながら直す作業なので、列のそろった表にする。
              100台を超えるので高さを止めて見出しを貼り付ける (T7 §2-1)。
            */}
            <DataTable
              caption="車両ごとのリース料と割賦支払額"
              maxHeight="24rem"
              rows={filtered}
              rowKey={(r) => r.vehicleNo}
              columns={[
                {
                  key: "vehicleNo",
                  header: "車番",
                  cellClassName: "num font-semibold",
                  cell: (r) => r.vehicleNo,
                },
                {
                  key: "vehicleType",
                  header: "車種",
                  priority: "low",
                  cellClassName: "text-ink-muted",
                  cell: (r) => r.vehicleType,
                },
                ...(
                  [
                    { key: "lease", label: "リース料", colIndex: 0 },
                    { key: "installment", label: "割賦支払額", colIndex: 1 },
                  ] as const
                ).map(({ key, label, colIndex }) => ({
                  key,
                  header: label,
                  // 単位はセルではなく見出しに置く (T7 §4-4)
                  unit: "円",
                  align: "right" as const,
                  cell: (r: LeaseEditorRow) => {
                    const v = values[r.vehicleNo] ?? { lease: "", installment: "" };
                    // 共通部品は「人が触っていない = 空文字」で持つ。
                    // ここは常に実額を保存するので、いまの値と同じなら空文字として渡す。
                    const currentRaw = String(r[key]);
                    return (
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
                    );
                  },
                })),
                {
                  key: "save",
                  header: "保存",
                  align: "right",
                  cell: (r) =>
                    savedNo === r.vehicleNo && !changed(r) ? (
                      <span className="text-xs text-ink-muted">保存済み</span>
                    ) : (
                      <button
                        type="button"
                        disabled={!canEdit || !changed(r) || savingNo === r.vehicleNo}
                        onClick={() => save(r)}
                        className="btn btn-secondary btn-sm pressable"
                      >
                        {savingNo === r.vehicleNo ? "保存中…" : "保存する"}
                      </button>
                    ),
                },
              ]}
              empty={
                <p className="text-xs text-ink-muted">
                  「{query}」に一致する車両はありません。絞り込みの言葉を消すと、全車両が出ます。
                </p>
              }
            />
          </div>

          {!canEdit && (
            <div className="mt-3">
              <AlertPanel tone="caution" title="金額を直すには入力権限が必要です。閲覧のみ可能です。">
                直す必要があるときは、管理者に権限の変更を依頼してください。
              </AlertPanel>
            </div>
          )}

          {error && (
            <div className="mt-3">
              <AlertPanel tone="danger" title={error} />
            </div>
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
