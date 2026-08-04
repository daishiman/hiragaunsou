import { describe, expect, it } from "vitest";
import { WORKFLOW_STEPS, findWorkflowStep } from "../../src/domain/rules/workflowSteps";

describe("findWorkflowStep", () => {
  it("idが一致する手順定義を返す", () => {
    const step = findWorkflowStep(2);
    expect(step?.title).toBe("売上データの取り込み・整形と車番別集計");
    expect(step?.isJudgementHeavy).toBe(true);
  });

  it("STEP1(車両別運行実績表の取り込み)は属人的な判断が要らない手順として定義される", () => {
    const step = findWorkflowStep(1);
    expect(step?.isJudgementHeavy).toBe(false);
    expect(step?.mode).toBe("import");
  });

  it("範囲外のidはundefinedを返す(画面側で存在チェックに使える)", () => {
    expect(findWorkflowStep(0)).toBeUndefined();
    expect(findWorkflowStep(9)).toBeUndefined();
  });

  it("WORKFLOW_STEPSの全8ステップがfindWorkflowStepで引ける(定義漏れが無い)", () => {
    expect(WORKFLOW_STEPS).toHaveLength(8);
    for (const step of WORKFLOW_STEPS) {
      expect(findWorkflowStep(step.id)?.title).toBe(step.title);
    }
  });
});
