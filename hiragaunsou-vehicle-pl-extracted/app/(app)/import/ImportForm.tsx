"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IMPORT_SOURCES, type ImportSourceType } from "../../../src/domain/rules/importSources";
import { selectableYearMonths } from "../../_lib/yearMonth";

type Batch = { fileName: string; rowCount: number; importedAt: number };

type Result = { ok: boolean; fileName: string; message: string };

type Conflict = {
  sourceType: ImportSourceType;
  file: File;
  sameFileName: boolean;
  superseded: Batch[];
};

type YearMonthMismatch = {
  sourceType: ImportSourceType;
  file: File;
  selectedYearMonth: string;
  detectedYearMonth: string;
  matchedRows: number;
  dominantCount: number;
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
/** ?step=1 のような業務フロー番号を、その帳票のsourceTypeへ読み替える */
function sourceTypeFromWorkflowStep(step: string | null): ImportSourceType | null {
  if (!step) return null;
  const stepLabel = `STEP${step}`;
  return IMPORT_SOURCES.find((s) => s.step === stepLabel)?.sourceType ?? null;
}

export function ImportForm({
  yearMonth,
  imported,
  initialWorkflowStep = null,
}: {
  yearMonth: string;
  imported: Record<string, Batch[]>;
  initialWorkflowStep?: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<ImportSourceType | null>(null);
  const [results, setResults] = useState<Partial<Record<ImportSourceType, Result>>>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [yearMonthMismatch, setYearMonthMismatch] = useState<YearMonthMismatch | null>(null);

  const doneCount = IMPORT_SOURCES.filter((source) => (imported[source.sourceType] ?? []).length > 0).length;

  // ホームの各STEPカード「この手順を開く」から来たときは、その帳票を主役にする。
  // サイドバー「データ取込」から来たとき(指定なし)は、まだ取り込んでいない最初の帳票を
  // 自動で主役にする。取り込むたびに imported が更新され、次の帳票へ自動で主役が移る
  // ("STEP1が終わったらSTEP2が出てくる"という進行を、押し進めるボタンなしで実現する)。
  const explicitFocusSourceType = sourceTypeFromWorkflowStep(initialWorkflowStep);
  const nextIncompleteSource = IMPORT_SOURCES.find(
    (source) => (imported[source.sourceType] ?? []).length === 0,
  );
  const lastSource = IMPORT_SOURCES[IMPORT_SOURCES.length - 1]!;
  const focusSourceType =
    explicitFocusSourceType ?? nextIncompleteSource?.sourceType ?? lastSource.sourceType;

  async function upload(
    sourceType: ImportSourceType,
    file: File,
    replace: boolean,
    confirmYearMonth = false,
  ) {
    setPending(sourceType);
    setConflict(null);
    setYearMonthMismatch(null);
    const form = new FormData();
    form.append("file", file);
    form.append("yearMonth", yearMonth);
    if (replace) form.append("replace", "true");
    if (confirmYearMonth) form.append("confirmYearMonth", "true");

    try {
      // サーバーに全く到達できなかった場合(オフライン・DNS失敗等)と、サーバーが
      // 応答した場合とで、利用者に伝えるべき対処が違うため区別する。
      let res: Response;
      try {
        res = await fetch(`/api/import/${sourceType}`, { method: "POST", body: form });
      } catch {
        setResults((prev) => ({
          ...prev,
          [sourceType]: {
            ok: false,
            fileName: file.name,
            message: "サーバーに接続できませんでした(通信エラー)。ネットワーク環境を確認し、再度お試しください。",
          },
        }));
        return;
      }

      // サーバーには到達したが、想定外の異常(未処理例外でJSONを返せなかった等)でレスポンス本文が
      // JSONとして読めない場合。「通信エラー」と混同すると調査対象を誤るため、別文言にする。
      let data: Record<string, unknown>;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        setResults((prev) => ({
          ...prev,
          [sourceType]: {
            ok: false,
            fileName: file.name,
            message: `サーバー側で問題が発生し、結果を読み取れませんでした(HTTP ${res.status})。時間をおいて再度お試しいただくか、解決しない場合は管理者にご連絡ください。`,
          },
        }));
        return;
      }

      if (res.status === 409 && data.error === "yearMonthMismatch") {
        const m = data.yearMonthMismatch as {
          selectedYearMonth: string;
          detectedYearMonth: string;
          matchedRows: number;
          dominantCount: number;
        };
        setYearMonthMismatch({
          sourceType,
          file,
          selectedYearMonth: m.selectedYearMonth,
          detectedYearMonth: m.detectedYearMonth,
          matchedRows: m.matchedRows,
          dominantCount: m.dominantCount,
        });
        return;
      }
      if (res.status === 409) {
        const c = data.conflict as { sameFileName: boolean; superseded: Batch[] };
        setConflict({ sourceType, file, sameFileName: c.sameFileName, superseded: c.superseded });
        return;
      }
      if (!res.ok) {
        setResults((prev) => ({
          ...prev,
          [sourceType]: {
            ok: false,
            fileName: file.name,
            message: String(data.error ?? `取込に失敗しました(HTTP ${res.status})`),
          },
        }));
        return;
      }
      setResults((prev) => ({
        ...prev,
        [sourceType]: { ok: true, fileName: file.name, message: describeResult(data) },
      }));
      router.refresh();
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
              setYearMonthMismatch(null);
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

      <p className="text-xs font-semibold text-ink-muted">
        {nextIncompleteSource
          ? "取り込み終えた帳票と、まだの帳票は畳んでいます。他の帳票が必要なときはタップして開けます。"
          : "すべて取込済みです。内容を直したいときはタップして開けます。"}
      </p>

      {[...IMPORT_SOURCES].sort((a, b) => {
        if (!focusSourceType) return 0;
        if (a.sourceType === focusSourceType) return -1;
        if (b.sourceType === focusSourceType) return 1;
        return 0;
      }).map((source) => {
        const batches = imported[source.sourceType] ?? [];
        const result = results[source.sourceType];
        const isPending = pending === source.sourceType;
        const isConflicting = conflict?.sourceType === source.sourceType;
        const isYearMonthMismatching = yearMonthMismatch?.sourceType === source.sourceType;
        // ホームの特定STEPカードから来たときは、その帳票だけを主役にして他を畳む。
        // フォーカス無し(サイドバー「データ取込」から直接来た)ときは全部を並列に見せる。
        const isFocused = !focusSourceType || source.sourceType === focusSourceType;

        const body = (
          <>
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
                    : "rounded-full border border-dashed border-line bg-white px-3 py-1 text-xs font-semibold text-ink-muted"
                }
              >
                {batches.length > 0 ? `✓ 取込済み ${batches.length}件` : "未取込"}
              </span>
            </div>

            <p className="mt-2 text-xs text-ink-muted">{source.hint}</p>

            {batches.length > 0 ? (
              <ul className="mt-3 space-y-1 border-l-2 border-line pl-3">
                {batches.map((batch) => (
                  <li key={`${batch.fileName}-${batch.importedAt}`} className="text-xs text-ink-muted">
                    {batch.fileName}（{batch.rowCount}件・{formatDateTime(batch.importedAt)} 取込）
                  </li>
                ))}
              </ul>
            ) : null}

            {/* STEP2(売上モニタリスト)が取り込めたら、次にやること(データ整形)へ誘導する */}
            {source.sourceType === "sales_monitor" && batches.length > 0 && !isConflicting ? (
              <Link
                href={`/cleansing?ym=${yearMonth}`}
                className="pressable mt-3 inline-flex items-center gap-1 rounded-md bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-deep hover:bg-brand-soft/70"
              >
                次へ: データ整形(STEP2)に進む →
              </Link>
            ) : null}

            {isYearMonthMismatching ? (
              <div className="mt-4 rounded-lg border border-caution-border bg-caution-soft p-4">
                <p className="text-sm font-bold text-ink">
                  「{yearMonthMismatch.file.name}」の中身は主に {yearMonthMismatch.detectedYearMonth}{" "}
                  の伝票のようです。対象年月「{yearMonthMismatch.selectedYearMonth}」と違いますが、このまま取り込みますか?
                </p>
                <p className="mt-2 text-xs leading-5 text-ink-muted">
                  積荷日を読み取れた {yearMonthMismatch.matchedRows} 件中 {yearMonthMismatch.dominantCount}{" "}
                  件が {yearMonthMismatch.detectedYearMonth} でした。前月分など別の年月のファイルを取り違えていないか確認してください。
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void upload(
                        yearMonthMismatch.sourceType,
                        yearMonthMismatch.file,
                        false,
                        true,
                      )
                    }
                    className="rounded-md bg-brand-deep px-4 py-2 text-sm font-semibold text-white"
                  >
                    このまま取り込む
                  </button>
                  <button
                    type="button"
                    onClick={() => setYearMonthMismatch(null)}
                    className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : null}

            {isConflicting ? (
              // border-warning / bg-amber-50 は本プロジェクトのトークンに存在せず
              // 枠線が消えていた。注意の面は caution トークンで描く。
              <div className="mt-4 rounded-lg border border-caution-border bg-caution-soft p-4">
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
                {conflict.sourceType === "sales_monitor" ? (
                  // 整形判断は伝票の自然キー(管理№-行№)に紐づくため、取込をやり直しても残る。
                  // 「全部やり直しになる」と誤解して入れ直しを避けるのを防ぐ。
                  <p className="mt-2 text-xs leading-5 text-ink-muted">
                    データ整形(STEP2)で下した判断は伝票ごとに保存されているため、入れ直しても引き継がれます。
                  </p>
                ) : null}
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
            ) : isYearMonthMismatching ? null : (
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
            {result && !isConflicting && !isYearMonthMismatching ? (
              <p className={`mt-2 text-xs leading-5 ${result.ok ? "text-ink-muted" : "text-danger"}`}>
                {result.fileName}: {result.message}
              </p>
            ) : null}
          </>
        );

        if (isFocused) {
          return (
            <section key={source.sourceType} className="rounded-xl border border-line bg-white p-5">
              {body}
            </section>
          );
        }

        return (
          <details
            key={source.sourceType}
            className="group rounded-lg border border-line border-dashed bg-white px-4 py-2"
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs">
              <span className="shrink-0 rounded bg-subtle px-1.5 py-0.5 font-semibold text-ink-muted">
                {source.step}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-muted">{source.label}</span>
              <span className="shrink-0 font-medium text-ink-muted">
                {batches.length > 0 ? `✓ 取込済み ${batches.length}件` : "未取込"}
              </span>
            </summary>
            <div className="mt-3 border-t border-line pt-3">{body}</div>
          </details>
        );
      })}

      {/* 毎回は読まない前提の説明。畳んで初見の情報量を下げる */}
      <details className="rounded-xl border border-line bg-white px-5 py-4">
        <summary className="cursor-pointer text-sm font-bold text-ink">取込の扱い</summary>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-ink-muted">
          <li>車番「88888」は傭車として自動除外します。</li>
          <li>「諸口」と、10・888・5000番の重複候補は削除せず要確認として原本とともに保存します。</li>
          <li>同じ年月の同じ帳票を取り込むと、確認のうえ既存データを削除して入れ直します。</li>
          <li>キリン配賦、燃料・修繕・高速の原票PDF取込は次段階で追加します。</li>
        </ul>
      </details>

      {(imported.monthly_pl_workbook ?? []).length > 0 ? (
        <Link href={`/grid?ym=${yearMonth}`} className="text-sm font-semibold text-brand-deep underline">
          {yearMonth} の車両別収支表を見る
        </Link>
      ) : null}
    </div>
  );
}
