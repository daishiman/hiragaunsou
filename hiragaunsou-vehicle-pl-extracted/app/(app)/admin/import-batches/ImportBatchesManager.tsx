"use client";

import { useMemo, useState } from "react";
import type { ImportBatchSummary } from "../../../../src/usecase/steps/manageImportBatches";
import type { AuditLogRecord } from "../../../../src/domain/repositories/AuditLogRepository";
import type { FileImportLogEntry } from "../../../../src/infrastructure/db/D1FileImportLogRepository";
import { ConfirmDialog } from "../../../_components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../../../_components/DataTable";
import { EmptyState } from "../../../_components/EmptyState";
import { StickyFilterBar } from "../../../_components/StickyFilterBar";
import { SectionHeading } from "../../../_components/SectionHeading";
import { Badge } from "../../../_components/Badge";
import { Prose } from "../../../_components/Card";
import { FIELD_CLASS, FIELD_LABEL_CLASS } from "../../../_components/formStyles";
import { dateTimeLabel, yearMonthLabel } from "../../../_lib/format";
import { importBatchStatusLabel, sourceTypeLabel } from "../../../_lib/kindLabels";

/** 記録がどの画面から取り込まれたか。利用者にはメニュー名で見せる。 */
const SCREEN_LABELS: Record<string, string> = {
  import: "データ取込",
  vehicle_master: "車両マスタ管理",
  driver_master: "運転者マスタ管理",
};

type RowState = { status: "idle" } | { status: "deleting" } | { status: "error"; message: string };

/**
 * 取込データ管理。
 *
 * ■ 表か否か（T7 §4-1 の質問への答え）
 * この画面でやりたいのは「どの月のどの帳票が、いつ・誰の手で入ったか」を行をまたいで
 * 見比べ、要らない1件を見つけて削除することなので、器は表（DataTable）のままでよい。
 * 1件を読み込んで判断する画面ではないため、定義リストには替えない。
 *
 * ■ 固定するもの（T7 §2-1・§2-3）
 * 取込は数百件になりうるのに、絞り込みの条件も件数も列見出しも流れて消えていた。
 * 条件と件数は StickyFilterBar、列見出しは DataTable の maxHeight（高さの上限を与えて
 * 縦スクロールにしないと、overflow の箱の中では sticky が効かない）で固定する。
 */
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
  /** 確認待ちの対象。何を削除するのかを画面に出してから確定させる。 */
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
      // データ本体を削除すると取込の記録も消えるので、画面の記録一覧も取り直す。
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
   * 取込の記録だけを取り消す。取り込んだデータ自体は削除せず「取り込み済み」の目印を外すだけなので、
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

  /** 取込の履歴。数百件になりうるので maxHeight で列見出しを固定する。 */
  const batchColumns: DataTableColumn<ImportBatchSummary>[] = [
    {
      key: "yearMonth",
      header: "対象年月",
      cell: (b) => yearMonthLabel(b.yearMonth),
    },
    {
      key: "sourceType",
      header: "帳票の種類",
      cell: (b) => sourceTypeLabel(b.sourceType),
    },
    {
      key: "fileName",
      header: "ファイル名",
      cellClassName: "wrap text-ink-muted",
      cell: (b) => b.fileName,
    },
    {
      key: "rowCount",
      header: "件数",
      unit: "件",
      align: "right",
      cell: (b) => (
        <>
          {b.rowCount}
          {b.excludedRowCount > 0 ? (
            <span className="ml-1 text-[10px] text-ink-muted">（除外{b.excludedRowCount}）</span>
          ) : null}
        </>
      ),
    },
    {
      key: "status",
      header: "状態",
      cell: (b) => (
        <Badge tone={b.status === "completed" ? "brand" : "caution"}>
          {importBatchStatusLabel(b.status)}
        </Badge>
      ),
    },
    {
      key: "importedAt",
      header: "取込日時",
      priority: "low",
      cellClassName: "whitespace-nowrap text-ink-muted",
      cell: (b) => dateTimeLabel(b.importedAt),
    },
    {
      key: "importedBy",
      header: "取込者",
      priority: "low",
      cellClassName: "text-ink-muted",
      cell: (b) => b.importedByName ?? "—",
    },
    {
      key: "actions",
      header: "できること",
      cell: (b) => {
        const state = rowState[b.id] ?? { status: "idle" };
        return (
          <>
            <button
              type="button"
              disabled={state.status === "deleting"}
              onClick={() => setPendingBatch(b)}
              className="btn btn-danger btn-sm pressable"
            >
              {state.status === "deleting" ? "削除中…" : "この取込を削除する"}
            </button>
            {state.status === "error" ? (
              <p className="mt-1 text-[11px] text-danger">{state.message}</p>
            ) : null}
          </>
        );
      },
    },
  ];

  /** 取り込んだファイルの記録。取込のたびに1行増えるので、こちらも見出しを固定する。 */
  const fileLogColumns: DataTableColumn<FileImportLogEntry>[] = [
    {
      key: "importedAt",
      header: "取込日時",
      cellClassName: "whitespace-nowrap text-ink-muted",
      cell: (f) => dateTimeLabel(f.importedAt),
    },
    {
      key: "screen",
      header: "取り込んだ画面",
      cell: (f) => SCREEN_LABELS[f.screen] ?? f.screen,
    },
    {
      key: "sourceType",
      header: "帳票の種類",
      cell: (f) => sourceTypeLabel(f.sourceType),
    },
    {
      key: "yearMonth",
      header: "対象年月",
      cell: (f) => (f.yearMonth ? yearMonthLabel(f.yearMonth) : "—"),
    },
    {
      key: "fileName",
      header: "ファイル名",
      cellClassName: "wrap text-ink-muted",
      cell: (f) => f.fileName,
    },
    {
      key: "rowCount",
      header: "件数",
      unit: "件",
      align: "right",
      cell: (f) => f.rowCount,
    },
    {
      key: "importedBy",
      header: "取込者",
      priority: "low",
      cellClassName: "text-ink-muted",
      cell: (f) => f.importedByName,
    },
    {
      key: "actions",
      header: "できること",
      cell: (f) => (
        <button
          type="button"
          disabled={fileLogBusy === f.id}
          onClick={() => setPendingForget(f)}
          className="btn btn-quiet btn-sm pressable"
        >
          {fileLogBusy === f.id ? "処理中…" : "記録から外す"}
        </button>
      ),
    },
  ];

  /** 削除履歴。いつ・誰が・何を削除したかを並べて見比べる。 */
  const deletionColumns: DataTableColumn<AuditLogRecord>[] = [
    {
      key: "createdAt",
      header: "削除した日時",
      cellClassName: "whitespace-nowrap text-ink-muted",
      cell: (entry) => dateTimeLabel(entry.createdAt),
    },
    { key: "actor", header: "削除した人", cell: (entry) => entry.actorName },
    {
      key: "summary",
      header: "削除した内容",
      cellClassName: "wrap",
      cell: (entry) => entry.summary,
    },
  ];

  return (
    <div className="space-y-6">
      {/*
        「何月の・どの帳票を・何件見ているか」は、下までスクロールしても要る前提。
        この画面には工程タブが無いので below は既定の "header"。
      */}
      <StickyFilterBar
        summary={`全${batches.length}件のうち${filtered.length}件を表示`}
      >
        <label className="flex items-center gap-2">
          <span className={FIELD_LABEL_CLASS}>対象年月で絞り込み</span>
          <input
            type="text"
            placeholder="2026-08"
            value={yearMonthFilter}
            onChange={(e) => setYearMonthFilter(e.target.value)}
            className={`${FIELD_CLASS} w-32`}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className={FIELD_LABEL_CLASS}>帳票の種類で絞り込み</span>
          <select
            value={sourceTypeFilter}
            onChange={(e) => setSourceTypeFilter(e.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">すべて</option>
            {sourceTypes.map((st) => (
              <option key={st} value={st}>
                {sourceTypeLabel(st)}
              </option>
            ))}
          </select>
        </label>
      </StickyFilterBar>

      <section className="card p-5">
        <SectionHeading divider={false} action={`${filtered.length}件`}>
          取込の履歴
        </SectionHeading>
        <div className="mt-3">
          <DataTable
            caption="取り込んだ帳票の履歴。対象年月・帳票の種類・件数・取込日時で見比べる。"
            columns={batchColumns}
            rows={filtered}
            rowKey={(b) => b.id}
            maxHeight="28rem"
            empty={
              batches.length === 0 ? (
                <EmptyState
                  title="取り込んだ帳票がまだありません"
                  description="この画面には、データ取込で取り込んだ帳票が並びます。まだ1件も取り込んでいないため空です。"
                  actionHref="/import"
                />
              ) : (
                <EmptyState
                  title="絞り込みの条件に合う取込がありません"
                  description="対象年月または帳票の種類の指定に合う取込が1件もありません。条件を変えるか、データ取込で新しく取り込んでください。"
                  actionHref="/import"
                />
              )
            }
          />
        </div>
      </section>

      <section className="card p-5">
        <SectionHeading divider={false} action={`${fileLog.length}件`}>
          取り込んだファイルの記録
        </SectionHeading>
        <Prose className="mt-1">
          どの画面で・いつ・どのファイルを取り込んだかの記録です。同じファイルをもう一度選んだときに
          「取り込み済みです」とお知らせするために使っています。もう一度取り込み直したいときは
          「記録から外す」を押してください（取り込んだデータ自体は削除されません）。
        </Prose>
        <div className="mt-3">
          <DataTable
            caption="取り込んだファイルの記録。同じファイルの二重取込を防ぐ照合に使う。"
            columns={fileLogColumns}
            rows={fileLog}
            rowKey={(f) => f.id}
            maxHeight="24rem"
            empty={
              <p className="rounded-lg bg-subtle px-4 py-3 text-xs text-ink-muted">
                まだ記録はありません。データ取込・車両マスタ管理・運転者マスタ管理でファイルを
                取り込むと、ここに1件ずつ残ります。
              </p>
            }
          />
        </div>
      </section>

      <section className="card p-5">
        <SectionHeading divider={false} action={`直近${deletionLog.length}件`}>
          削除履歴
        </SectionHeading>
        <Prose className="mt-1">いつ・誰が・何を削除したかの記録です。監査用に残ります。</Prose>
        <div className="mt-3">
          <DataTable
            caption="取込データの削除履歴。いつ・誰が・何を削除したか。"
            columns={deletionColumns}
            rows={deletionLog}
            rowKey={(entry) => entry.id}
            maxHeight="20rem"
            empty={
              <p className="rounded-lg bg-subtle px-4 py-3 text-xs text-ink-muted">
                削除履歴はありません。まだ取込データを1件も削除していないためです。
                上の「取込の履歴」で削除すると、ここに記録が残ります。
              </p>
            }
          />
        </div>
      </section>

      <ConfirmDialog
        open={pendingBatch !== null}
        title="以下の取込データを削除します。取り消せません。よろしいですか？"
        confirmLabel="削除する"
        onCancel={() => setPendingBatch(null)}
        onConfirm={() => {
          if (pendingBatch) void deleteBatch(pendingBatch);
        }}
      >
        {pendingBatch ? (
          <p className="font-semibold text-ink">
            {yearMonthLabel(pendingBatch.yearMonth)} / {sourceTypeLabel(pendingBatch.sourceType)} /{" "}
            {pendingBatch.fileName}（{pendingBatch.rowCount}件）
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
        <p>取り込んだデータ自体は削除されません。同じファイルをもう一度取り込めるようになります。</p>
      </ConfirmDialog>
    </div>
  );
}
