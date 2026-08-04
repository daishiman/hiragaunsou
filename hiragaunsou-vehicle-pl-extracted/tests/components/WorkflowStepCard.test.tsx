/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepCard } from "../../app/_components/WorkflowStepCard";
import type { WorkflowStepDefinition } from "../../src/domain/rules/workflowSteps";
import type { WorkflowStepProgress } from "../../src/usecase/steps/getWorkflowProgress";

function makeStep(overrides: Partial<WorkflowStepDefinition> = {}): WorkflowStepDefinition {
  return {
    id: 2,
    title: "売上データの取り込み",
    summary: "売上モニタリストを取り込む",
    source: "車楽クラウド",
    mode: "import",
    href: "/import?step=2",
    notes: ["諸口は確認して修正・削除します。"],
    isJudgementHeavy: false,
    ...overrides,
  };
}

function makeProgress(overrides: Partial<WorkflowStepProgress> = {}): WorkflowStepProgress {
  return {
    step: makeStep(),
    status: "partial",
    detail: "43台中12台入力済み",
    blocked: false,
    ...overrides,
  };
}

describe("WorkflowStepCard", () => {
  it("isNext=trueのとき強調カードでSTEP番号・タイトル・モード・状態を表示する", () => {
    render(<WorkflowStepCard progress={makeProgress()} isNext />);
    expect(screen.getByText("STEP 2")).toBeInTheDocument();
    expect(screen.getByText("売上データの取り込み")).toBeInTheDocument();
    expect(screen.getByText("取込")).toBeInTheDocument();
    expect(screen.getByText("入力途中")).toBeInTheDocument();
    expect(screen.getByText("43台中12台入力済み")).toBeInTheDocument();
  });

  it("notesが有る場合は件数付きの見出しと一覧を表示する", () => {
    render(<WorkflowStepCard progress={makeProgress()} isNext />);
    expect(screen.getByText(/判断ポイント\s*1件/)).toBeInTheDocument();
    expect(screen.getByText(/諸口は確認して修正・削除します。/)).toBeInTheDocument();
  });

  it("notesが空の場合は件数表示も一覧も出さない", () => {
    render(
      <WorkflowStepCard
        progress={makeProgress({ step: makeStep({ notes: [] }) })}
        isNext
      />,
    );
    expect(screen.getByText("この手順について")).toBeInTheDocument();
    expect(screen.queryByText(/判断ポイント/)).not.toBeInTheDocument();
  });

  it("isJudgementHeavyのときは注意文を表示する", () => {
    const { rerender } = render(
      <WorkflowStepCard
        progress={makeProgress({ step: makeStep({ isJudgementHeavy: true }) })}
        isNext
      />,
    );
    expect(screen.getByText(/経験に頼っている判断が残っています/)).toBeInTheDocument();

    rerender(<WorkflowStepCard progress={makeProgress()} isNext />);
    expect(screen.queryByText(/経験に頼っている判断が残っています/)).not.toBeInTheDocument();
  });

  it("blockedのときは手順を開くリンクの代わりに案内文を出す", () => {
    render(<WorkflowStepCard progress={makeProgress({ blocked: true })} isNext />);
    expect(screen.getByText("STEP 1・2 の取込が終わると着手できます")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "この手順を開く" })).not.toBeInTheDocument();
  });

  it("blockedでなければ手順を開くリンクをstep.hrefで出す", () => {
    render(<WorkflowStepCard progress={makeProgress()} isNext />);
    const link = screen.getByRole("link", { name: "この手順を開く" });
    expect(link).toHaveAttribute("href", "/import?step=2");
  });

  it("isNext=falseのときはコンパクト行(details/summary)で表示する", () => {
    render(<WorkflowStepCard progress={makeProgress()} isNext={false} />);
    expect(screen.queryByText("この手順について")).not.toBeInTheDocument();
    expect(screen.getByText("売上データの取り込み")).toBeInTheDocument();
    expect(screen.getByText("この手順を開く")).toBeInTheDocument();
  });

  it("isNext=false かつ status=done のときはリンク文言が内容を見直すになる", () => {
    render(
      <WorkflowStepCard
        progress={makeProgress({ status: "done" })}
        isNext={false}
      />,
    );
    expect(screen.getByRole("link", { name: "内容を見直す" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "この手順を開く" })).not.toBeInTheDocument();
  });

  it("isNext=false かつ blockedのときはリンクではなく案内文を出す", () => {
    render(
      <WorkflowStepCard
        progress={makeProgress({ blocked: true })}
        isNext={false}
      />,
    );
    expect(screen.getByText("STEP 1・2 の取込が終わると着手できます")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
