"use client";

import { useMemo, useState } from "react";
import type { ImportBatchSummary } from "../../../../src/usecase/steps/manageImportBatches";
import type { AuditLogRecord } from "../../../../src/domain/repositories/AuditLogRepository";

const SOURCE_TYPE_LABELS: Record<string, string> = {
  vehicle_operation: "車両別運行実績表",
  sales_monitor: "売上モニタリスト",
  payroll: "給与集計表",
  monthly_pl_workbook: "完成済み収支表(Excel)",
};

type RowState = { status: "idle" } | { status: "deleting" } | { status: "error"; message: string };

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ImportBatchesManager({
  initialBatches,
  initialDeletionLog,
}: {
  initialBatches: ImportBatchSummary[];
  initialDeletionLog: AuditLogRecord[];
}) {
  const [batches, setBatches] = useState(initialBatches);
  const [deletionLog, setDeletionLog] = useState(initialDeletionLog);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [yearMonthFilter, setYearMonthFilter] = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState("");

  const sourceTypes = useMemo(
    () => Array.from(new Set(batches.map((b) => b.sourceType))).sort(),
    [batches],
  );

  const filtered = useMemo(
    () =>
      batches.filter(
        (b) =>
          (yearMonthFilter === "" || b.yearMonth === yearMonthFilter) &&
          (sourceTypeFilter === "" || b.sourceType === sourceTypeFilter),
      ),
    [batches, yearMonthFilter, sourceTypeFilter],
  );

  async function deleteBatch(batch: ImportBatchSummary) {
    const label = `${batch.yearMonth} / ${SOURCE_TYPE_LABELS[batch.sourceType] ?? batch.sourceType} / ${batch.fileName}(${batch.rowCount}行)`;
    if (
      !window.confirm(
        `以下の取込データを削除します。取り消せません。よろしいですか?\n\n${label}`,
      )
    ) {
      return;
    }
    setRowState((prev) => ({ ...prev, [batch.id]: { status: "deleting" } }));
    try {
      const res = await fetch(`/api/admin/import-batches?id=${encodeURIComponent(batch.id)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setRowState((prev) => ({
          ...prev,
          [batch.id]: { status: "error", message: data?.error ?? "削除に失敗しました" },
        }));
        return;
      }
      setBatches((prev) => prev.filter((b) => b.id !== batch.id));
      setRowState((prev) => {
        const next = { ...prev };
        delete next[batch.id];
        return next;
      });
      const listRes = await fetch("/api/admin/import-batches");
      const listData = (await listRes.json().catch(() => null)) as {
        deletionLog?: AuditLogRecord[];
      } | null;
      if (listRes.ok && listData?.deletionLog) {
        setDeletionLog(listData.deletionLog);
      }
    } catch {
      setRowState((prev) => ({
        ...prev,
        [batch.id]: { status: "error", message: "通信エラーが発生しました" },
      }));
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-white p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            年月で絞り込み
            <input
              type="text"
              placeholder="2026-08"
              value={yearMonthFilter}
              onChange={(e) => setYearMonthFilter(e.target.value)}
              className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            帳票種別で絞り込み
            <select
              value={sourceTypeFilter}
              onChange={(e) => setSourceTypeFilter(e.target.value)}
              className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink"
            >
              <option value="">すべて</option>
              {sourceTypes.map((st) => (
                <option key={st} value={st}>
                  {SOURCE_TYPE_LABELS[st] ?? st}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-ink-muted">{filtered.length}件</span>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-muted">
                <th className="py-2 pr-3">年月</th>
                <th className="py-2 pr-3">帳票種別</th>
                <th className="py-2 pr-3">ファイル名</th>
                <th className="py-2 pr-3">行数</th>
                <th className="py-2 pr-3">状態</th>
                <th className="py-2 pr-3">取込日時</th>
                <th className="py-2 pr-3">取込者</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const state = rowState[b.id] ?? { status: "idle" };
                return (
                  <tr key={b.id} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3">{b.yearMonth}</td>
                    <td className="py-2 pr-3 text-ink-muted">
                      {SOURCE_TYPE_LABELS[b.sourceType] ?? b.sourceType}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">{b.fileName}</td>
                    <td className="py-2 pr-3 text-ink-muted">
                      {b.rowCount}
                      {b.excludedRowCount > 0 ? (
                        <span className="ml-1 text-[11px]">(除外{b.excludedRowCount})</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">{b.status}</td>
                    <td className="py-2 pr-3 text-ink-muted">{formatDateTime(b.importedAt)}</td>
                    <td className="py-2 pr-3 text-ink-muted">{b.importedByName ?? "-"}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        disabled={state.status === "deleting"}
                        onClick={() => void deleteBatch(b)}
                        className="pressable rounded-md border border-caution-border bg-caution-soft px-3 py-1 text-xs font-semibold text-danger disabled:opacity-50"
                      >
                        {state.status === "deleting" ? "削除中…" : "削除"}
                      </button>
                      {state.status === "error" ? (
                        <p className="mt-1 text-[11px] text-danger">{state.message}</p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-xs text-ink-muted">
                    該当する取込データはありません。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">削除履歴(直近{deletionLog.length}件)</h2>
        <p className="mt-1 text-xs text-ink-muted">
          いつ・誰が・何を削除したかの記録です。監査用に残ります。
        </p>
        {deletionLog.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2 text-xs">
            {deletionLog.map((entry) => (
              <li key={entry.id} className="rounded-md border border-line px-3 py-2">
                <span className="text-ink-muted">{formatDateTime(entry.createdAt)}</span>
                <span className="mx-1 text-ink-muted">·</span>
                <span className="font-semibold text-ink">{entry.actorName}</span>
                <span className="mx-1 text-ink-muted">が</span>
                <span className="text-ink">{entry.summary}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-ink-muted">削除履歴はありません。</p>
        )}
      </section>
    </div>
  );
}
