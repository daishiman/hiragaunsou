"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertPanel } from "../../_components/AlertPanel";
import { ConfirmDialog } from "../../_components/ConfirmDialog";
import { Disclosure } from "../../_components/Disclosure";
import { EmptyState } from "../../_components/EmptyState";
import { FIELD_LABELS, formatCellValue } from "../../_lib/fieldLabels";
import type { VehiclePlField } from "../../../src/domain/entities/VehiclePl";
import { yearMonthLabel } from "../../_lib/format";
import type { MasterChangeStatus } from "../../../src/usecase/steps/applyMasterChange";
import type { VehiclePlRowDiff } from "../../../src/domain/rules/masterChangeImpact";

/**
 * 「直したこと」と「まだ反映していない月」を1画面で扱う。
 *
 * まだ締めていない月は直した時点で反映済みなので、ここには出てこない。
 * ここに並ぶのは確定済みの月だけ = 「反映するかどうかを人が決める必要があるもの」だけにする。
 */
export function MasterChangeManager({
  status,
  loadError,
}: {
  /** 画面を開いた時点の食い違い・履歴。サーバ側で読んで渡す */
  status: MasterChangeStatus | null;
  loadError?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(loadError ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 確認ダイアログで反映しようとしている月 (空なら閉じている) */
  const [pending, setPending] = useState<string[] | null>(null);

  /** 反映・取り消しのあとは、サーバで数え直した内容に画面を合わせる */
  const reload = () => router.refresh();

  async function apply(yearMonths: string[]) {
    setBusy(true);
    setPending(null);
    try {
      const res = await fetch("/api/master-changes/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonths }),
      });
      const data = (await res.json()) as {
        applied?: { yearMonth: string; vehicleCount: number }[];
        error?: string;
      };
      if (data.error) setError(data.error);
      else setError(null);
      const applied = data.applied ?? [];
      if (applied.length > 0) {
        setNotice(
          `${applied.map((a) => yearMonthLabel(a.yearMonth)).join("・")} の収支表を新しい内容にしました`,
        );
      }
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function undo(input: { editId?: string; applyId?: string }, label: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/master-changes/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await res.json()) as { error?: string };
      if (data.error) setError(data.error);
      else {
        setError(null);
        setNotice(`${label} を1つ前の状態に戻しました`);
      }
      reload();
    } finally {
      setBusy(false);
    }
  }

  const months = status?.months ?? [];

  return (
    <div className="space-y-4">
      {error ? <AlertPanel tone="danger" title={error} /> : null}
      {notice ? <AlertPanel tone="success" title={notice} /> : null}

      {status === null ? null : months.length === 0 ? (
        <EmptyState
          title="いま食い違っている月はありません"
          description="マスタを直すと、まだ締めていない月にはその場で反映されます。締めた月に違いが出たときだけ、ここに並びます。"
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-ink">
              締めた月のうち {months.length}件が、いまのマスタと違います
            </p>
            {months.length > 1 ? (
              <button
                type="button"
                className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                disabled={busy}
                onClick={() => setPending(months.map((m) => m.yearMonth))}
              >
                まとめて反映する
              </button>
            ) : null}
          </div>

          {months.map((month) => (
            <div key={month.yearMonth} className="rounded-lg border border-line bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-ink">
                  <span className="font-bold">{yearMonthLabel(month.yearMonth)}</span>
                  <span className="ml-2">
                    {month.vehicleCount}台の数字が変わります
                    {month.profitDelta !== 0
                      ? ` (利益 ${month.profitDelta > 0 ? "+" : ""}${Math.round(month.profitDelta).toLocaleString()}円)`
                      : ""}
                  </span>
                </p>
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                  disabled={busy}
                  onClick={() => setPending([month.yearMonth])}
                >
                  この月に反映する
                </button>
              </div>

              <Disclosure summary={`どこが違うかを見る (${month.rows.length}台)`}>
                <ul className="space-y-1">
                  {month.rows.map((row) => (
                    <li key={row.vehicleNo}>{rowLines(row)}</li>
                  ))}
                </ul>
              </Disclosure>
            </div>
          ))}
        </div>
      )}

      {status && status.applies.length > 0 ? (
        <Disclosure summary={`反映した記録 (${status.applies.length}件)`}>
          <ul className="space-y-1.5">
            {status.applies.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3">
                <span>
                  {yearMonthLabel(a.yearMonth)} : {a.summary} / {a.appliedByName}
                  {a.revertedAt ? "(取り消し済み)" : ""}
                </span>
                {a.revertedAt ? null : (
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm pressable shrink-0"
                    disabled={busy}
                    onClick={() =>
                      void undo({ applyId: a.id }, `${yearMonthLabel(a.yearMonth)} の反映`)
                    }
                  >
                    この反映を取り消す
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {status && status.edits.length > 0 ? (
        <Disclosure summary={`直した記録 (${status.edits.length}件)`}>
          <ul className="space-y-1.5">
            {status.edits.map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3">
                <span>
                  {e.targetLabel} の{e.fieldLabel}: {e.beforeValue ?? "(空)"} →{" "}
                  {e.afterValue ?? "(空)"} / {e.editedByName}
                  {e.undoneAt ? "(戻し済み)" : ""}
                </span>
                {e.undoneAt ? null : (
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm pressable shrink-0"
                    disabled={busy}
                    onClick={() => void undo({ editId: e.id }, `${e.targetLabel} の${e.fieldLabel}`)}
                  >
                    この直しを元に戻す
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {/*
        締めた月の数字を動かす操作なので、押す前に「何がどう変わるか」を必ず見せる。
        件数だけの確認は「はい」を押す練習にしかならない。
      */}
      <ConfirmDialog
        open={pending !== null}
        tone="caution"
        title="締めた月の数字を新しい内容にします"
        confirmLabel="反映する"
        busy={busy}
        onConfirm={() => void apply(pending ?? [])}
        onCancel={() => setPending(null)}
      >
        <p className="mb-2">配布済みの表と数字が変わります。あとから元に戻せます。</p>
        <ul className="space-y-1 text-xs">
          {(pending ?? []).map((ym) => {
            const m = months.find((x) => x.yearMonth === ym);
            if (!m) return null;
            return (
              <li key={ym}>
                <span className="font-semibold">{yearMonthLabel(ym)}</span> :{" "}
                {m.vehicleCount}台 / 利益 {m.profitDelta > 0 ? "+" : ""}
                {Math.round(m.profitDelta).toLocaleString()}円
              </li>
            );
          })}
        </ul>
      </ConfirmDialog>
    </div>
  );
}

/** 1台ぶんの違いを、読める1〜2行にする */
function rowLines(row: VehiclePlRowDiff) {
  if (row.kind === "added") return `車番 ${row.vehicleNo}: 今回から表に載ります`;
  if (row.kind === "removed") return `車番 ${row.vehicleNo}: 表から外れます`;

  const primary = row.changes.filter((c) => c.primary);
  const shown = (primary.length > 0 ? primary : row.changes).slice(0, 3);
  const rest = (primary.length > 0 ? primary : row.changes).length - shown.length;

  // 項目の日本語名と整形は収支表の画面と同じものを使う。ここだけ別の書き方にすると、
  // 同じ数字が画面ごとに違う見え方をする。
  const body = shown
    .map((c) => {
      const field = c.field as VehiclePlField;
      return `${FIELD_LABELS[field] ?? c.field}: ${formatCellValue(field, c.before)} → ${formatCellValue(field, c.after)}`;
    })
    .join(" / ");

  return `車番 ${row.vehicleNo}: ${body}${rest > 0 ? ` ほか${rest}件` : ""}`;
}
