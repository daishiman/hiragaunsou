import { describe, expect, it } from "vitest";
import { GetTodoBoardUseCase } from "../../src/usecase/steps/getTodoBoard";
import type { ReviewFlagRepository } from "../../src/domain/repositories/VehiclePlRepository";

function stubReviewFlagRepo(
  flags: Awaited<ReturnType<ReviewFlagRepository["findOpenByYearMonth"]>>,
): ReviewFlagRepository {
  return {
    createFlags: async () => {},
    findOpenByYearMonth: async () => flags,
    resolve: async () => {},
  };
}

describe("GetTodoBoardUseCase", () => {
  it("openなフラグを重要度順(critical>warning>info)に並べて返す", async () => {
    const useCase = new GetTodoBoardUseCase(
      stubReviewFlagRepo([
        {
          id: "1",
          vehicleNo: "101",
          field: "hours",
          type: "missing_input",
          severity: "info",
          message: "任意項目未入力",
          status: "open",
        },
        {
          id: "2",
          vehicleNo: "102",
          field: "fuelIn",
          type: "digit_suspect",
          severity: "critical",
          message: "桁ミスの疑い",
          status: "open",
        },
        {
          id: "3",
          vehicleNo: "103",
          field: "toll",
          type: "range_deviation",
          severity: "warning",
          message: "例月から乖離",
          status: "open",
        },
      ]),
    );

    const res = await useCase.execute("2026-05");

    expect(res.totalOpen).toBe(3);
    expect(res.cards.map((c) => c.id)).toEqual(["2", "3", "1"]);
    expect(res.emptyMessage).toBeNull();
  });

  it("openなフラグがゼロの場合は完了メッセージを返す", async () => {
    const useCase = new GetTodoBoardUseCase(stubReviewFlagRepo([]));
    const res = await useCase.execute("2026-06");

    expect(res.totalOpen).toBe(0);
    expect(res.cards).toHaveLength(0);
    expect(res.emptyMessage).toBe("今月の入力は完了しています");
  });
});
