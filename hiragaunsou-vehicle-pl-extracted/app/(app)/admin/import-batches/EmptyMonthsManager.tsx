"use client";

import { useState } from "react";
import type { MonthlyPlSummary } from "../../../../src/usecase/steps/manageMonthlyPlData";
import type { AuditLogRecord } from "../../../../src/domain/repositories/AuditLogRepository";
import { ConfirmDialog } from "../../../_components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../../../_components/DataTable";
import { SectionHeading } from "../../../_components/SectionHeading";
import { AlertPanel } from "../../../_components/AlertPanel";
import { Prose } from "../../../_components/Card";
import { dateTimeLabel, yearMonthLabel, yen } from "../../../_lib/format";

/**
 * ファイルを1件も取り込んでいないのに収支表だけが残っている月の一覧と、その削除。
 *
 * この状態の月は、走行も売上も0のまま固定費だけが並ぶ赤字の行になり、ホームの経営サマリや
 * 年間集計に架空の数字として混ざる。新しく作られないようにはしたが、すでにできた分は
 * 中身を見た人にしか削除してよいか判断できないため、探す手間だけをこちらで引き受け、
 * 削除するかどうかは利用者が決める形にする。
 *
 * ■ 表か否か（T7 §4-1 の質問への答え）
 * 「どの月が実態のない赤字になっているか」を月をまたいで見比べて、要らない月を削除する
 * 画面なので器は表（DataTable）。1件を読んで判断する画面ではない。
 *
 * ■ 言葉
 * 同じページの取込データ管理と語がそろっていなかった（「消す」「消した記録」）ため、
 * T7 §1-1 に従い「削除する」「削除履歴」に統一する。
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
        setError(data?.error ?? "収支表を削除できませんでした");
        return;
      }
      setMonths((prev) => prev.filter((m) => m.yearMonth !== target.yearMonth));
      setDone(
        `${yearMonthLabel(target.yearMonth)}の収支表 ${data?.deletedRows ?? target.vehicleCount}台分を削除しました`,
      );
      setPending(null);
      // 削除の記録がその場で見えないと、本当に残ったのか利用者に確かめようがない。
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

  const monthColumns: DataTableColumn<MonthlyPlSummary>[] = [
    {
      key: "yearMonth",
      header: "対象年月",
      cellClassName: "font-bold text-ink whitespace-nowrap",
      cell: (m) => yearMonthLabel(m.yearMonth),
    },
    {
      key: "vehicleCount",
      header: "車両",
      unit: "台",
      align: "right",
      cell: (m) => m.vehicleCount,
    },
    { key: "sales", header: "売上", unit: "円", align: "right", cell: (m) => yen(m.sales) },
    { key: "profit", header: "損益", unit: "円", align: "right", cell: (m) => yen(m.profit) },
    {
      key: "confirmed",
      header: "確定済み",
      unit: "台",
      align: "right",
      priority: "low",
      cell: (m) => m.confirmed,
    },
    {
      key: "actions",
      header: "できること",
      cell: (m) =>
        m.confirmed > 0 ? (
          // 確定は「この数字で締めた」という意思表示。削除する前に、その意思表示を戻してもらう。
          <span className="text-xs text-ink-muted">
            確定済みのため削除できません。先に月次収支表で確定を取り消してください。
          </span>
        ) : (
          <button type="button" className="btn btn-danger btn-sm pressable" onClick={() => setPending(m)}>
            この月の収支表を削除する
          </button>
        ),
    },
  ];

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
    <section className="mt-8 card p-5">
      <SectionHeading
        divider={false}
        action={`${months.length}件`}
        note="この月の収支表は、走行も売上も入っていないまま固定費だけが計上されています。ホームの経営サマリや年間集計に実態のない赤字として混ざるため、心当たりが無ければ削除してください。削除すると元に戻せません。"
      >
        ファイルを取り込んでいないのに収支表がある月
      </SectionHeading>

      <div className="mt-3">
        <DataTable
          caption="ファイルを1件も取り込んでいないのに収支表だけが残っている月。"
          columns={monthColumns}
          rows={months}
          rowKey={(m) => m.yearMonth}
          maxHeight="20rem"
          empty={
            <p className="rounded-lg bg-subtle px-4 py-3 text-sm text-ink-muted">
              該当する月はありません。実態のない赤字が混ざっている月は無いので、このまま
              月次収支表や年間集計をご覧ください。
            </p>
          }
        />
      </div>

      {done ? (
        <div className="mt-3">
          <AlertPanel tone="success" title={done} />
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <AlertPanel tone="danger" title="収支表を削除できませんでした">
            <p>{error}</p>
          </AlertPanel>
        </div>
      ) : null}

      <div className="mt-5 border-t border-line pt-4">
        <SectionHeading divider={false} action={`${deletionLog.length}件`}>
          削除履歴
        </SectionHeading>
        <Prose className="mt-1">いつ・誰が・どの月の収支表を削除したかの記録です。</Prose>
        <div className="mt-2">
          <DataTable
            caption="収支表の削除履歴。いつ・誰が・どの月を削除したか。"
            columns={deletionColumns}
            rows={deletionLog}
            rowKey={(entry) => entry.id}
            maxHeight="20rem"
            empty={
              <p className="rounded-lg bg-subtle px-4 py-3 text-xs text-ink-muted">
                削除履歴はありません。まだ収支表を1件も削除していないためです。
                上の一覧で削除すると、ここに記録が残ります。
              </p>
            }
          />
        </div>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `${yearMonthLabel(pending.yearMonth)}の収支表を削除しますか？` : ""}
        confirmLabel="削除する"
        busy={busy}
        onConfirm={() => {
          if (pending) void remove(pending);
        }}
        onCancel={() => setPending(null)}
      >
        {pending ? (
          <div className="text-sm text-ink">
            <p>次の内容が削除されます。元に戻せません。</p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-ink-muted">
              <li>
                {yearMonthLabel(pending.yearMonth)}の車両別の収支 {pending.vehicleCount}台分
              </li>
              <li>売上 {yen(pending.sales)}円</li>
              <li>損益 {yen(pending.profit)}円</li>
            </ul>
            <p className="mt-2 text-ink-muted">
              取り込んだファイルは削除されません。この月にはファイルが1件も取り込まれていません。
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
