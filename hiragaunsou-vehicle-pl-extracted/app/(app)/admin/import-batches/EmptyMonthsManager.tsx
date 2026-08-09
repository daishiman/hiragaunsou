"use client";

import { useState } from "react";
import type { MonthlyPlSummary } from "../../../../src/usecase/steps/manageMonthlyPlData";
import type { AuditLogRecord } from "../../../../src/domain/repositories/AuditLogRepository";
import { ConfirmDialog } from "../../../_components/ConfirmDialog";
import { yearMonthLabel } from "../../../_lib/format";

/**
 * ファイルを1件も取り込んでいないのに収支表だけが残っている月の一覧と、その削除。
 *
 * この状態の月は、走行も売上も0のまま固定費だけが並ぶ赤字の行になり、ホームの経営サマリや
 * 年間集計に架空の数字として混ざる。新しく作られないようにはしたが、すでにできた分は
 * 中身を見た人にしか消してよいか判断できないため、探す手間だけをこちらで引き受け、
 * 消すかどうかは利用者が決める形にする。
 */
export function EmptyMonthsManager({
  initialMonths,
  initialDeletionLog,
}: {
  initialMonths: MonthlyPlSummary[];
  initialDeletionLog: AuditLogRecord[];
}) {
  const [months, setMonths] = useState(initialMonths);
  const [deletionLog, setDeletionLog] = useState(initialDeletionLog);
  const [pending, setPending] = useState<MonthlyPlSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function remove(target: MonthlyPlSummary) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/admin/monthly-pl?ym=${encodeURIComponent(target.yearMonth)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as {
        deletedRows?: number;
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? "収支表を消せませんでした");
        return;
      }
      setMonths((prev) => prev.filter((m) => m.yearMonth !== target.yearMonth));
      setDone(
        `${yearMonthLabel(target.yearMonth)}の収支表 ${data?.deletedRows ?? target.vehicleCount}台分を消しました`,
      );
      setPending(null);
      // 消した記録がその場で見えないと、本当に残ったのか利用者に確かめようがない。
      const listRes = await fetch("/api/admin/monthly-pl");
      const listData = (await listRes.json().catch(() => null)) as {
        months?: MonthlyPlSummary[];
        deletionLog?: AuditLogRecord[];
      } | null;
      if (listRes.ok && listData?.months) setMonths(listData.months);
      if (listRes.ok && listData?.deletionLog) setDeletionLog(listData.deletionLog);
    } catch {
      setError("サーバーに接続できませんでした。通信を確認してもう一度お試しください");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 card p-5">
      <h2 className="text-base font-bold text-ink">ファイルを取り込んでいないのに収支表がある月</h2>
      <p className="mt-1 text-sm leading-6 text-ink-muted">
        この月の収支表は、走行も売上も入っていないまま固定費だけが計上されています。ホームの経営サマリや年間集計に実態のない赤字として混ざるため、心当たりが無ければ消してください。消すと元に戻せません。
      </p>

      {months.length === 0 ? (
        <p className="mt-4 rounded-lg bg-subtle px-4 py-3 text-sm text-ink-muted">
          該当する月はありません。
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {months.map((m) => (
            <li
              key={m.yearMonth}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-4 py-3"
            >
              <div>
                <p className="text-sm font-bold text-ink">{yearMonthLabel(m.yearMonth)}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {m.vehicleCount}台分 ／ 売上 {Math.round(m.sales).toLocaleString("ja-JP")}円 ／ 損益{" "}
                  {Math.round(m.profit).toLocaleString("ja-JP")}円
                  {m.confirmed > 0 ? ` ／ うち確定済み ${m.confirmed}台` : ""}
                </p>
              </div>
              {m.confirmed > 0 ? (
                // 確定は「この数字で締めた」という意思表示。消す前に、その意思表示を戻してもらう。
                <p className="text-xs text-ink-muted">
                  確定済みのため消せません。先に月次収支表で確定を取り消してください。
                </p>
              ) : (
                <button
                  type="button"
                  className="btn btn-quiet pressable text-danger"
                  onClick={() => setPending(m)}
                >
                  この月の収支表を消す
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {done ? <p className="mt-3 text-sm font-semibold text-ink">{done}</p> : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      <div className="mt-5 border-t border-line pt-4">
        <h3 className="text-sm font-bold text-ink">消した記録</h3>
        {deletionLog.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-2 text-xs">
            {deletionLog.map((entry) => (
              <li key={entry.id} className="rounded-md border border-line px-3 py-2">
                <span className="text-ink-muted">
                  {new Date(entry.createdAt).toLocaleString("ja-JP")}
                </span>
                <span className="mx-1 text-ink-muted">·</span>
                <span className="font-semibold text-ink">{entry.actorName}</span>
                <span className="mx-1 text-ink-muted">が</span>
                <span className="text-ink">{entry.summary}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-ink-muted">まだ消した記録はありません。</p>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `${yearMonthLabel(pending.yearMonth)}の収支表を消しますか?` : ""}
        confirmLabel="消す"
        busy={busy}
        onConfirm={() => {
          if (pending) void remove(pending);
        }}
        onCancel={() => setPending(null)}
      >
        {pending ? (
          <div className="text-sm text-ink">
            <p>次の内容が消えます。元に戻せません。</p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-ink-muted">
              <li>{yearMonthLabel(pending.yearMonth)}の車両別の収支 {pending.vehicleCount}台分</li>
              <li>売上 {Math.round(pending.sales).toLocaleString("ja-JP")}円</li>
              <li>損益 {Math.round(pending.profit).toLocaleString("ja-JP")}円</li>
            </ul>
            <p className="mt-2 text-ink-muted">
              取り込んだファイルは消えません。この月にはファイルが1件も取り込まれていません。
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
