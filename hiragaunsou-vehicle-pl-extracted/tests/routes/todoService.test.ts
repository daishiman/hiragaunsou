import { describe, expect, it } from "vitest";
import {
  buildTodoResponse,
  type ReviewFlagRecord,
} from "../../src/usecase/steps/getTodoBoard";

function flag(overrides: Partial<ReviewFlagRecord>): ReviewFlagRecord {
  return {
    id: "1",
    yearMonth: "2026-05",
    vehicleNo: "1",
    field: "repair",
    type: "digit_suspect",
    severity: "warning",
    message: "疑義",
    monthlyReference: null,
    status: "open",
    ...overrides,
  };
}

describe("buildTodoResponse", () => {
  it("openのカードのみ対象にする", () => {
    const res = buildTodoResponse("2026-05", [
      flag({ id: "1", status: "open" }),
      flag({ id: "2", status: "corrected" }),
    ]);
    expect(res.totalOpen).toBe(1);
    expect(res.cards.map((c) => c.id)).toEqual(["1"]);
  });

  it("critical > warning > info の優先度順に並べる", () => {
    const res = buildTodoResponse("2026-05", [
      flag({ id: "info", severity: "info" }),
      flag({ id: "critical", severity: "critical" }),
      flag({ id: "warning", severity: "warning" }),
    ]);
    expect(res.cards.map((c) => c.id)).toEqual(["critical", "warning", "info"]);
  });

  it("ToDoがゼロの場合、完了メッセージを返す(S1画面の空状態)", () => {
    const res = buildTodoResponse("2026-05", []);
    expect(res.totalOpen).toBe(0);
    expect(res.emptyMessage).toBe("今月の入力は完了しています");
  });

  it("ToDoが1件でもあればemptyMessageはnull", () => {
    const res = buildTodoResponse("2026-05", [flag({})]);
    expect(res.emptyMessage).toBeNull();
  });
});
