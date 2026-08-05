/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStepCard } from "../../app/_components/WorkflowStepCard";
import { WORKFLOW_STEPS } from "../../src/domain/rules/workflowSteps";
import type { WorkflowStepProgress } from "../../src/usecase/steps/getWorkflowProgress";

function progressFor(stepId: number): WorkflowStepProgress {
  const step = WORKFLOW_STEPS.find((s) => s.id === stepId)!;
  return { step, status: "todo", detail: "未着手", blocked: false };
}

/**
 * ホームは当月の進捗を出すのに、/import は ym が無いと既定の前月を開いてしまい、
 * 見ていた月と作業する月がずれていた。手順を開くリンクに対象月を必ず引き継ぐ。
 */
describe("WorkflowStepCard の対象月引き継ぎ", () => {
  it("yearMonthを渡すと、強調カードの「この手順を開く」にymが付く", () => {
    render(<WorkflowStepCard progress={progressFor(1)} isNext yearMonth="2026-08" />);
    expect(screen.getByRole("link", { name: "この手順を開く" })).toHaveAttribute(
      "href",
      "/import?step=1&ym=2026-08",
    );
  });

  it("コンパクト行のリンクにもymが付く", () => {
    render(<WorkflowStepCard progress={progressFor(3)} isNext={false} yearMonth="2026-08" />);
    expect(screen.getByRole("link", { name: "この手順を開く" })).toHaveAttribute(
      "href",
      "/manual-entry?step=3&ym=2026-08",
    );
  });

  it("全8ステップのリンク先が対象月を引き継げる(ym無しのSTEPを残さない)", () => {
    for (const step of WORKFLOW_STEPS) {
      const { unmount } = render(
        <WorkflowStepCard progress={progressFor(step.id)} isNext yearMonth="2026-08" />,
      );
      expect(screen.getByRole("link", { name: "この手順を開く" })).toHaveAttribute(
        "href",
        expect.stringContaining("ym=2026-08"),
      );
      unmount();
    }
  });

  it("yearMonthを渡さなければ従来どおりstep.hrefのまま", () => {
    render(<WorkflowStepCard progress={progressFor(1)} isNext />);
    expect(screen.getByRole("link", { name: "この手順を開く" })).toHaveAttribute(
      "href",
      "/import?step=1",
    );
  });
});

describe("WORKFLOW_STEPS", () => {
  it("STEP1の見出しは画面の呼び名「車両実績表等の取り込み」に合わせる", () => {
    expect(WORKFLOW_STEPS.find((s) => s.id === 1)?.title).toBe("車両実績表等の取り込み");
  });
});
