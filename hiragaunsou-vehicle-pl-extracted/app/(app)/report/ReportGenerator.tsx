"use client";

import { useState } from "react";
import type { FactorAnalysisReport } from "../../../src/domain/services/FactorAnalysisAiPort";
import { currentYearMonth, selectableYearMonths } from "../../_lib/yearMonth";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; report: FactorAnalysisReport; monthsAnalyzed: string[] }
  | { status: "error"; message: string };

export function ReportGenerator() {
  const [targetYearMonth, setTargetYearMonth] = useState(currentYearMonth());
  const [state, setState] = useState<State>({ status: "idle" });

  async function generate() {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetYearMonth }),
      });
      const data = (await res.json()) as { error?: string; report?: FactorAnalysisReport; monthsAnalyzed?: string[] };
      if (!res.ok || !data.report) {
        setState({ status: "error", message: data.error ?? "レポート生成に失敗しました" });
        return;
      }
      setState({ status: "done", report: data.report, monthsAnalyzed: data.monthsAnalyzed ?? [] });
    } catch {
      setState({ status: "error", message: "通信エラーが発生しました" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          対象年月
          <select
            value={targetYearMonth}
            onChange={(e) => setTargetYearMonth(e.target.value)}
            disabled={state.status === "loading"}
            className="rounded-md border border-line bg-white px-2 py-1 text-sm text-ink"
          >
            {selectableYearMonths(13).map((ym) => (
              <option key={ym} value={ym}>
                {ym}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={state.status === "loading"}
          className="btn btn-primary pressable"
        >
          {state.status === "loading" ? "レポートを作成しています…" : "レポートを作成する"}
        </button>
      </div>

      {state.status === "loading" ? (
        <div className="rounded-xl border border-line bg-white p-5">
          <div className="skeleton h-4 w-full" aria-hidden />
          <div className="skeleton mt-2 h-4 w-3/4" aria-hidden />
          <p className="mt-3 text-xs text-ink-muted">
            過去数か月分の収支データをもとにAIが要因を分析しています(数十秒かかることがあります)。
          </p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="rounded-md border border-caution-border bg-caution-soft px-4 py-3 text-xs">
          {state.message}
        </div>
      ) : null}

      {state.status === "done" ? (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-ink-muted">
            分析対象月: {state.monthsAnalyzed.join(" / ")}
          </p>
          <section className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-bold text-ink">要約</h2>
            <p className="mt-2 text-sm text-ink">{state.report.summary}</p>
          </section>

          <section className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-bold text-ink">主な変動要因</h2>
            <div className="mt-3 flex flex-col gap-2">
              {state.report.keyDrivers.map((driver, i) => (
                <div key={i} className="border-b border-line py-2 text-sm last:border-b-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-ink">{driver.factor}</span>
                    <span
                      className={`num font-semibold ${driver.impact === "positive" ? "text-brand-deep" : "text-danger"}`}
                    >
                      {driver.impact === "positive" ? "+" : "-"}
                      {Math.abs(driver.amountYen).toLocaleString("ja-JP")}円
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{driver.explanation}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-line bg-white p-5">
            <h2 className="text-sm font-bold text-ink">推奨アクション</h2>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
              {state.report.recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </section>

          {state.report.lowConfidenceNotes.length > 0 ? (
            <section className="rounded-md border border-caution-border bg-caution-soft p-4">
              <h2 className="text-xs font-bold text-ink">断定できなかった論点</h2>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs text-ink">
                {state.report.lowConfidenceNotes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
