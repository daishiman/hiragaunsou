import { describe, expect, it } from "vitest";
import {
  GetAnomalyQueueUseCase,
  SPARK_MONTHS,
  medianOf,
  recommendationOf,
} from "../../src/usecase/steps/getAnomalyQueue";
import { plRow } from "../fixtures/vehiclePlRow";
import { stubReviewFlagRepo, stubVehiclePlRepo } from "../fixtures/stubRepositories";

function flag(overrides: Partial<{ id: string; vehicleNo: string; field: string; severity: string }> = {}) {
  return {
    id: "f1",
    vehicleNo: "101",
    field: "repair",
    type: "spike",
    severity: "warning",
    message: "例月より大きく増えています",
    status: "open",
    ...overrides,
  };
}

describe("medianOf", () => {
  it("奇数件は中央、偶数件は中央2件の平均", () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
  });

  it("母集団が空なら null (0と混同させない)", () => {
    expect(medianOf([])).toBeNull();
  });
});

describe("recommendationOf", () => {
  it("優先度低は「これで正しい」、それ以外は「入力ミス」を推奨する", () => {
    expect(recommendationOf("低")).toBe("approved");
    expect(recommendationOf("中")).toBe("corrected");
    expect(recommendationOf("高")).toBe("corrected");
  });
});

describe("GetAnomalyQueueUseCase", () => {
  it("直近12ヶ月の推移を添え、中央値は当月を除いて算出する", async () => {
    const byMonth: Record<string, ReturnType<typeof plRow>[]> = {};
    // 2025-06〜2026-04 は 10,000 円、当月 2026-05 だけ 500,000 円
    for (let i = 6; i <= 12; i += 1) byMonth[`2025-${String(i).padStart(2, "0")}`] = [plRow({ no: "101", repair: 10_000 })];
    for (let i = 1; i <= 4; i += 1) byMonth[`2026-${String(i).padStart(2, "0")}`] = [plRow({ no: "101", repair: 10_000 })];
    byMonth["2026-05"] = [plRow({ no: "101", repair: 500_000 })];

    const useCase = new GetAnomalyQueueUseCase(
      stubReviewFlagRepo([flag()]),
      stubVehiclePlRepo(byMonth),
    );
    const res = await useCase.execute("2026-05");
    const item = res.items[0];

    expect(item?.spark).toHaveLength(SPARK_MONTHS);
    expect(item?.spark[0]?.yearMonth).toBe("2025-06");
    expect(item?.value).toBe(500_000);
    expect(item?.median).toBe(10_000); // 当月の 500,000 に引っ張られない
    expect(item?.ratioToMedian).toBe(50);
  });

  it("優先度の高い順に並べる", async () => {
    const useCase = new GetAnomalyQueueUseCase(
      stubReviewFlagRepo([
        flag({ id: "low", severity: "info" }),
        flag({ id: "high", severity: "critical" }),
        flag({ id: "mid", severity: "warning" }),
      ]),
      stubVehiclePlRepo({}),
    );
    const res = await useCase.execute("2026-05");
    expect(res.items.map((i) => i.id)).toEqual(["high", "mid", "low"]);
    expect(res.items.map((i) => i.priority)).toEqual(["高", "中", "低"]);
  });

  it("過去データが引けない項目は中央値・倍率を null にする", async () => {
    const useCase = new GetAnomalyQueueUseCase(stubReviewFlagRepo([flag()]), stubVehiclePlRepo({}));
    const res = await useCase.execute("2026-05");

    expect(res.items[0]?.median).toBeNull();
    expect(res.items[0]?.ratioToMedian).toBeNull();
    expect(res.items[0]?.value).toBeNull();
  });

  it("未判定が0件なら締めに進める状態として返す", async () => {
    const useCase = new GetAnomalyQueueUseCase(stubReviewFlagRepo([]), stubVehiclePlRepo({}));
    const res = await useCase.execute("2026-05");

    expect(res.totalOpen).toBe(0);
    expect(res.isDone).toBe(true);
  });
});
