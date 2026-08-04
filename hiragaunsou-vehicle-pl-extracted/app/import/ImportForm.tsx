"use client";

import Link from "next/link";
import { useState } from "react";
import { currentYearMonth, selectableYearMonths } from "../_lib/yearMonth";

type Result = {
  fileName: string;
  ok: boolean;
  sourceType?: string;
  data?: Record<string, unknown>;
  message?: string;
};

const SOURCE_LABELS: Record<string, string> = {
  vehicle_operation: "車両別運行実績表",
  sales_monitor: "売上モニタリスト",
  payroll: "給与集計表",
  monthly_pl_workbook: "完成済み車両別収支表（Excel）",
};

/**
 * 元ファイルをまとめて渡すための画面。
 * 利用者はファイル種別を選ばない。列構成/Excelの収支表見出しからサーバーが判定する。
 */
export function ImportForm() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  async function handleFiles(files: File[]) {
    if (files.length === 0 || pending) return;
    setPending(true);
    setResults([]);

    const next = await Promise.all(
      files.map(async (file): Promise<Result> => {
        const form = new FormData();
        form.append("file", file);
        form.append("yearMonth", yearMonth);
        try {
          const res = await fetch("/api/import/auto", { method: "POST", body: form });
          const data = (await res.json()) as Record<string, unknown>;
          if (!res.ok) return { fileName: file.name, ok: false, message: String(data.error ?? "取込に失敗しました") };
          return { fileName: file.name, ok: true, sourceType: String(data.sourceType), data };
        } catch {
          return { fileName: file.name, ok: false, message: "通信エラーが発生しました" };
        }
      }),
    );
    setResults(next);
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-brand bg-brand-soft p-5">
        <h2 className="text-base font-bold text-ink">元データをまとめて選択</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          CSV・Excelを選ぶだけで、列見出しとシート構造から種別を判定してR2へ原本保存し、D1へ取り込みます。
          ファイル名の年月・営業所名が変わっても、同じ帳票構成なら利用できます。
        </p>
        <p className="mt-2 text-xs leading-5 text-ink-muted">
          完成済みの「○月収支表」Excelは、保存済みの51列計算結果をそのまま一覧表へ反映します。Excelの数式結果が未保存の場合は、Excelで再計算・保存してから選択してください。
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            対象年月
            <select
              value={yearMonth}
              onChange={(e) => setYearMonth(e.target.value)}
              disabled={pending}
              className="rounded-md border border-line bg-white px-2 py-1 text-sm text-ink"
            >
              {selectableYearMonths(25).map((ym) => (
                <option key={ym} value={ym}>{ym}</option>
              ))}
            </select>
          </label>
          <input
            type="file"
            multiple
            accept=".csv,.xlsx"
            disabled={pending}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              void handleFiles(files);
              event.target.value = "";
            }}
            className="block max-w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-brand file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-deep hover:file:bg-brand-soft"
          />
        </div>
        {pending ? <p className="mt-3 text-xs text-ink-muted">内容を判定して取り込んでいます…</p> : null}
      </section>

      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-bold text-ink">取込の扱い</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-ink-muted">
          <li>車番「88888」は傭車として自動除外します。</li>
          <li>「諸口」と、10・888・5000番の重複候補は削除せず要確認として原本とともに保存します。</li>
          <li>キリン配賦、燃料・修繕・高速の原票PDF取込は次段階で追加します。現時点では完成済みExcelの取込で全51列を移行できます。</li>
        </ul>
      </section>

      {results.length > 0 ? (
        <section className="rounded-xl border border-line bg-white p-5">
          <h2 className="text-sm font-bold text-ink">取込結果</h2>
          <div className="mt-3 divide-y divide-line">
            {results.map((result) => (
              <div key={result.fileName} className="py-3 text-sm">
                <p className="font-semibold text-ink">{result.fileName}</p>
                {result.ok ? (
                  <div className="mt-1 text-xs text-ink-muted">
                    種別: {SOURCE_LABELS[result.sourceType ?? ""] ?? result.sourceType}
                    {result.data ? ` ／ ${Object.entries(result.data).filter(([key]) => key !== "sourceType" && key !== "storedFileKey" && key !== "batchId").map(([key, value]) => `${key}: ${String(value)}`).join(" ／ ")}` : ""}
                  </div>
                ) : <p className="mt-1 text-xs text-danger">{result.message}</p>}
              </div>
            ))}
          </div>
          {results.some((result) => result.ok && result.sourceType === "monthly_pl_workbook") ? (
            <Link href={`/grid?ym=${yearMonth}`} className="mt-4 inline-block text-sm font-semibold text-brand-deep underline">
              {yearMonth} の車両別収支表を見る
            </Link>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
