"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IMPORT_SOURCES, type ImportSourceType } from "../../src/domain/rules/importSources";
import { selectableYearMonths } from "../_lib/yearMonth";

type Batch = { fileName: string; rowCount: number; importedAt: number };

type Result = { ok: boolean; fileName: string; message: string };

type Conflict = {
  sourceType: ImportSourceType;
  file: File;
  sameFileName: boolean;
  superseded: Batch[];
};

function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 取込成功時、帳票ごとに意味のある件数だけを一行にまとめる。 */
function describeResult(data: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof data.sourceSheet === "string") parts.push(`シート「${data.sourceSheet}」`);
  if (typeof data.vehicleCount === "number") parts.push(`車両 ${data.vehicleCount} 台`);
  else if (typeof data.totalRows === "number") parts.push(`${data.totalRows} 件`);
  if (typeof data.charteredExcluded === "number" && data.charteredExcluded > 0) {
    parts.push(`傭車 ${data.charteredExcluded} 件を除外`);
  }
  if (typeof data.needsReviewCount === "number" && data.needsReviewCount > 0) {
    parts.push(`要確認 ${data.needsReviewCount} 件`);
  }
  return parts.join(" ／ ") || "取り込みました";
}

/**
 * 業務フローのSTEPごとに投入口を分けた取込画面。
 * 種別を利用者に選ばせるのではなく「どのSTEPの帳票か」を投入口で固定し、
 * サーバー側の自動判定は取り違え検知に使う。送信は1件ずつ直列に行う。
 */
export function ImportForm({
  yearMonth,
  imported,
}: {
  yearMonth: string;
  imported: Record<string, Batch[]>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<ImportSourceType | null>(null);
  const [results, setResults] = useState<Partial<Record<ImportSourceType, Result>>>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const doneCount = IMPORT_SOURCES.filter((source) => (imported[source.sourceType] ?? []).length > 0).length;

  async function upload(sourceType: ImportSourceType, file: File, replace: boolean) {
    setPending(sourceType);
    setConflict(null);
    const form = new FormData();
    form.append("file", file);
    form.append("yearMonth", yearMonth);
    if (replace) form.append("replace", "true");

    try {
      const res = await fetch(`/api/import/${sourceType}`, { method: "POST", body: form });
      const data = (await res.json()) as Record<string, unknown>;

      if (res.status === 409) {
        const c = data.conflict as { sameFileName: boolean; superseded: Batch[] };
        setConflict({ sourceType, file, sameFileName: c.sameFileName, superseded: c.superseded });
        return;
      }
      if (!res.ok) {
        setResults((prev) => ({
          ...prev,
          [sourceType]: { ok: false, fileName: file.name, message: String(data.error ?? "取込に失敗しました") },
        }));
        return;
      }
      setResults((prev) => ({
        ...prev,
        [sourceType]: { ok: true, fileName: file.name, message: describeResult(data) },
      }));
      router.refresh();
    } catch {
      setResults((prev) => ({
        ...prev,
        [sourceType]: { ok: false, fileName: file.name, message: "通信エラーが発生しました" },
      }));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand bg-brand-soft px-5 py-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          対象年月
          <select
            value={yearMonth}
            disabled={pending !== null}
            onChange={(e) => {
              setResults({});
              setConflict(null);
              router.replace(`/import?ym=${e.target.value}`);
            }}
            className="rounded-md border border-line bg-white px-2 py-1 text-sm font-normal text-ink"
          >
            {selectableYearMonths(25).map((ym) => (
              <option key={ym} value={ym}>{ym}</option>
            ))}
          </select>
        </label>
        <p className="text-sm font-semibold text-brand-deep">
          {doneCount} / {IMPORT_SOURCES.length} 完了
        </p>
      </section>

      {IMPORT_SOURCES.map((source) => {
        const batches = imported[source.sourceType] ?? [];
        const result = results[source.sourceType];
        const isPending = pending === source.sourceType;
        const isConflicting = conflict?.sourceType === source.sourceType;

        return (
          <section key={source.sourceType} className="rounded-xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-brand-deep">{source.step}</p>
                <h2 className="text-base font-bold text-ink">{source.label}</h2>
                <p className="mt-0.5 text-xs text-ink-muted">{source.system}</p>
              </div>
              <span
                className={
                  batches.length > 0
                    ? "rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-deep"
                    : "rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-ink-muted"
                }
              >
                {batches.length > 0 ? `取込済み ${batches.length}件` : "未取込"}
              </span>
            </div>

            <p className="mt-2 text-xs leading-5 text-ink-muted">{source.hint}</p>

            {batches.length > 0 ? (
              <ul className="mt-3 space-y-1 border-l-2 border-line pl-3">
                {batches.map((batch) => (
                  <li key={`${batch.fileName}-${batch.importedAt}`} className="text-xs text-ink-muted">
                    {batch.fileName}（{batch.rowCount}件・{formatDateTime(batch.importedAt)} 取込）
                  </li>
                ))}
              </ul>
            ) : null}

            {isConflicting ? (
              <div className="mt-4 rounded-lg border border-warning bg-amber-50 p-4">
                <p className="text-sm font-bold text-ink">
                  {conflict.sameFileName
                    ? `「${conflict.file.name}」は既に取り込み済みです。入れ直しますか?`
                    : `${yearMonth} の${source.label}は既に取り込み済みです。入れ直しますか?`}
                </p>
                <p className="mt-2 text-xs leading-5 text-ink">
                  入れ直すと、下記の既存データは<strong>削除</strong>されてから新しいファイルの内容に置き換わります。削除したデータは元に戻せません。
                </p>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
                  {conflict.superseded.map((batch) => (
                    <li key={`${batch.fileName}-${batch.importedAt}`}>
                      {batch.fileName}（{batch.rowCount}件・{formatDateTime(batch.importedAt)} 取込）
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void upload(conflict.sourceType, conflict.file, true)}
                    className="rounded-md bg-brand-deep px-4 py-2 text-sm font-semibold text-white"
                  >
                    削除して入れ直す
                  </button>
                  <button
                    type="button"
                    onClick={() => setConflict(null)}
                    className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <input
                type="file"
                accept={source.accept}
                disabled={pending !== null}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void upload(source.sourceType, file, false);
                }}
                className="mt-3 block max-w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-brand file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-deep hover:file:bg-brand-soft disabled:opacity-50"
              />
            )}

            {isPending ? <p className="mt-2 text-xs text-ink-muted">取り込んでいます…</p> : null}
            {result && !isConflicting ? (
              <p className={`mt-2 text-xs leading-5 ${result.ok ? "text-ink-muted" : "text-danger"}`}>
                {result.fileName}: {result.message}
              </p>
            ) : null}
          </section>
        );
      })}

      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">取込の扱い</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-ink-muted">
          <li>車番「88888」は傭車として自動除外します。</li>
          <li>「諸口」と、10・888・5000番の重複候補は削除せず要確認として原本とともに保存します。</li>
          <li>同じ年月の同じ帳票を取り込むと、確認のうえ既存データを削除して入れ直します。</li>
          <li>キリン配賦、燃料・修繕・高速の原票PDF取込は次段階で追加します。</li>
        </ul>
      </section>

      {(imported.monthly_pl_workbook ?? []).length > 0 ? (
        <Link href={`/grid?ym=${yearMonth}`} className="text-sm font-semibold text-brand-deep underline">
          {yearMonth} の車両別収支表を見る
        </Link>
      ) : null}
    </div>
  );
}
