"use client";

import { useState } from "react";
import type { FactorAnalysisReport } from "../../../src/domain/services/FactorAnalysisAiPort";
import { selectableYearMonths } from "../../_lib/yearMonth";
import { yearMonthLabel } from "../../_lib/format";
import { FIELD_CLASS } from "../../_components/formStyles";
import { StickyFilterBar } from "../../_components/StickyFilterBar";
import { AlertPanel } from "../../_components/AlertPanel";
import { DefinitionList } from "../../_components/DefinitionList";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; report: FactorAnalysisReport; monthsAnalyzed: string[] }
  | { status: "error"; message: string };

export function ReportGenerator({ defaultYearMonth }: { defaultYearMonth: string }) {
  const [targetYearMonth, setTargetYearMonth] = useState(defaultYearMonth);
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
      {/*
        対象年月は、下に出る文章がどの月の話かを決める前提なので帯に貼る (T7 §2-3)。
        共通の YearMonthSelect は選ぶと ?ym= へ移動する部品で、この画面のように
        「選んでから作成を押す」使い方には合わないため、ここは素の選択欄のままにし、
        見た目だけ formStyles の FIELD_CLASS に揃える。表示は必ず「2026年5月」形式 (T7 §1)。
      */}
      <StickyFilterBar summary={`対象年月 ${yearMonthLabel(targetYearMonth)}`}>
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          対象年月
          <select
            value={targetYearMonth}
            onChange={(e) => setTargetYearMonth(e.target.value)}
            disabled={state.status === "loading"}
            className={FIELD_CLASS}
          >
            {selectableYearMonths(13).map((ym) => (
              <option key={ym} value={ym}>
                {yearMonthLabel(ym)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={state.status === "loading"}
          className="btn btn-primary btn-sm pressable"
        >
          {state.status === "loading" ? "レポートを作成しています…" : "レポートを作成する"}
        </button>
      </StickyFilterBar>

      {/* 何も無い理由と、次に何をすればよいかを必ず1行出す (T7 §4-4) */}
      {state.status === "idle" ? (
        <p className="text-xs text-ink-muted">
          まだレポートはありません。対象年月を選んで「レポートを作成する」を押すと、
          その月までの収支データをもとにAIが要因を文章にまとめます。
        </p>
      ) : null}

      {state.status === "loading" ? (
        <div className="card p-5">
          <div className="skeleton h-4 w-full" aria-hidden />
          <div className="skeleton mt-2 h-4 w-3/4" aria-hidden />
          <p className="mt-3 text-xs text-ink-muted">
            過去数か月分の収支データをもとにAIが要因を分析しています（数十秒かかることがあります）。
          </p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <AlertPanel tone="danger" title="レポートを作成できませんでした">
          {state.message}。対象年月を選び直すか、AI設定のプロバイダと鍵を確認してから、もう一度作成してください。
        </AlertPanel>
      ) : null}

      {state.status === "done" ? (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-ink-muted">
            分析対象年月: {state.monthsAnalyzed.map(yearMonthLabel).join(" / ")}
          </p>
          <section className="card p-5">
            <h2 className="text-sm font-bold text-ink">要約</h2>
            {/* AIが書いた続き文。カードは幅いっぱいのまま、行だけ読める長さで折り返す */}
            <p className="readable mt-2 text-sm text-ink">{state.report.summary}</p>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-bold text-ink">主な変動要因</h2>
            {/*
              器の判定 (T7 §4-1): 要因は列をまたいで見比べるものではなく
              「1件を読んで納得する」ものなので、表ではなく定義リストで出す。
            */}
            <DefinitionList
              className="mt-3"
              items={state.report.keyDrivers.map((driver) => ({
                term: driver.factor,
                value: (
                  <span
                    className={`num font-semibold ${driver.impact === "positive" ? "text-brand-deep" : "text-danger"}`}
                  >
                    {driver.impact === "positive" ? "+" : "-"}
                    {Math.abs(driver.amountYen).toLocaleString("ja-JP")}円
                  </span>
                ),
                note: <span className="readable block">{driver.explanation}</span>,
              }))}
            />
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-bold text-ink">推奨アクション</h2>
            <ul className="readable mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
              {state.report.recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </section>

          {state.report.lowConfidenceNotes.length > 0 ? (
            <AlertPanel tone="caution" title="断定できなかった論点">
              <ul className="readable flex list-disc flex-col gap-1 pl-5">
                {state.report.lowConfidenceNotes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </AlertPanel>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
