"use client";

import { useMemo, useState } from "react";
import type { ImportBatchSummary } from "../../../../src/usecase/steps/manageImportBatches";
import type { AuditLogRecord } from "../../../../src/domain/repositories/AuditLogRepository";
import type { FileImportLogEntry } from "../../../../src/infrastructure/db/D1FileImportLogRepository";
import { ConfirmDialog } from "../../../_components/ConfirmDialog";

const SOURCE_TYPE_LABELS: Record<string, string> = {
  vehicle_operation: "車両別運行実績表",
  sales_monitor: "売上モニタリスト",
  payroll: "給与集計表",
  monthly_pl_workbook: "完成済み収支表(Excel)",
  vehicle_master: "車両マスタ",
  driver_master: "運転者マスタ",
};

/** 記録がどの画面から取り込まれたか。利用者にはメニュー名で見せる。 */
const SCREEN_LABELS: Record<string, string> = {
  import: "データ取込",
  vehicle_master: "車両マスタ管理",
  driver_master: "運転者マスタ管理",
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
  initialFileLog,
}: {
  initialBatches: ImportBatchSummary[];
  initialDeletionLog: AuditLogRecord[];
  /** 取り込んだファイルの記録 (マスタ取込も含む)。同じファイルの二重取込を防ぐ照合に使う。 */
  initialFileLog: FileImportLogEntry[];
}) {
  const [batches, setBatches] = useState(initialBatches);
  const [deletionLog, setDeletionLog] = useState(initialDeletionLog);
  const [fileLog, setFileLog] = useState(initialFileLog);
  const [fileLogBusy, setFileLogBusy] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  /** 確認待ちの対象。何を消すのかを画面に出してから確定させる。 */
  const [pendingBatch, setPendingBatch] = useState<ImportBatchSummary | null>(null);
  const [pendingForget, setPendingForget] = useState<FileImportLogEntry | null>(null);
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
    setPendingBatch(null);
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
        fileLog?: FileImportLogEntry[];
      } | null;
      if (listRes.ok && listData?.deletionLog) {
        setDeletionLog(listData.deletionLog);
      }
      // データ本体を消すと取込の記録も消えるので、画面の記録一覧も取り直す。
      if (listRes.ok && listData?.fileLog) {
        setFileLog(listData.fileLog);
      }
    } catch {
      setRowState((prev) => ({
        ...prev,
        [batch.id]: { status: "error", message: "通信エラーが発生しました" },
      }));
    }
  }

  /**
   * 取込の記録だけを取り消す。取り込んだデータ自体は消さず「取り込み済み」の目印を外すだけなので、
   * 同じファイルをもう一度取り込めるようになる。
   */
  async function forgetFile(entry: FileImportLogEntry) {
    setPendingForget(null);
    setFileLogBusy(entry.id);
    try {
      const res = await fetch(`/api/admin/import-batches?logId=${encodeURIComponent(entry.id)}`, {
        method: "DELETE",
      });
      if (res.ok) setFileLog((prev) => prev.filter((f) => f.id !== entry.id));
    } catch {
      // 失敗しても記録は残るだけで実害が無いので、画面はそのままにする。
    } finally {
      setFileLogBusy(null);
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
          <table className="data-table min-w-full text-sm">
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
                        onClick={() => setPendingBatch(b)}
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
        <h2 className="text-sm font-bold text-ink">取り込んだファイルの記録({fileLog.length}件)</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">
          どの画面で・いつ・どのファイルを取り込んだかの記録です。同じファイルをもう一度選んだときに
          「取り込み済みです」とお知らせするために使っています。もう一度取り込み直したいときは
          「記録から外す」を押してください(取り込んだデータ自体は消えません)。
        </p>
        {fileLog.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <table className="data-table min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3">取込日時</th>
                  <th className="py-2 pr-3">取り込んだ画面</th>
                  <th className="py-2 pr-3">ファイルの種類</th>
                  <th className="py-2 pr-3">対象年月</th>
                  <th className="py-2 pr-3">ファイル名</th>
                  <th className="py-2 pr-3">件数</th>
                  <th className="py-2 pr-3">取込者</th>
                  <th className="py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {fileLog.map((f) => (
                  <tr key={f.id} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3 text-ink-muted">{formatDateTime(f.importedAt)}</td>
                    <td className="py-2 pr-3 text-ink-muted">{SCREEN_LABELS[f.screen] ?? f.screen}</td>
                    <td className="py-2 pr-3 text-ink-muted">
                      {SOURCE_TYPE_LABELS[f.sourceType] ?? f.sourceType}
                    </td>
                    <td className="py-2 pr-3 text-ink-muted">{f.yearMonth ?? "—"}</td>
                    <td className="py-2 pr-3 text-ink-muted">{f.fileName}</td>
                    <td className="py-2 pr-3 text-ink-muted">{f.rowCount}</td>
                    <td className="py-2 pr-3 text-ink-muted">{f.importedByName}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        disabled={fileLogBusy === f.id}
                        onClick={() => setPendingForget(f)}
                        className="btn btn-quiet btn-sm pressable"
                      >
                        {fileLogBusy === f.id ? "処理中…" : "記録から外す"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-ink-muted">まだ記録はありません。</p>
        )}
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

      <ConfirmDialog
        open={pendingBatch !== null}
        title="以下の取込データを削除します。取り消せません。よろしいですか?"
        confirmLabel="削除する"
        onCancel={() => setPendingBatch(null)}
        onConfirm={() => {
          if (pendingBatch) void deleteBatch(pendingBatch);
        }}
      >
        {pendingBatch ? (
          <p className="font-semibold text-ink">
            {pendingBatch.yearMonth} /{" "}
            {SOURCE_TYPE_LABELS[pendingBatch.sourceType] ?? pendingBatch.sourceType} /{" "}
            {pendingBatch.fileName}({pendingBatch.rowCount}行)
          </p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingForget !== null}
        title={
          pendingForget
            ? `「${pendingForget.fileName}」を取り込み済みの記録から外します。`
            : "取り込み済みの記録から外します。"
        }
        confirmLabel="記録から外す"
        tone="caution"
        onCancel={() => setPendingForget(null)}
        onConfirm={() => {
          if (pendingForget) void forgetFile(pendingForget);
        }}
      >
        <p>取り込んだデータ自体は消えません。同じファイルをもう一度取り込めるようになります。</p>
      </ConfirmDialog>
    </div>
  );
}
