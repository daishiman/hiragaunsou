import { describe, expect, it } from "vitest";
import { ConfirmMonthlyPlUseCase } from "../../src/usecase/steps/confirmMonthlyPl";
import { stubReviewFlagRepo, stubVehiclePlRepo } from "../fixtures/stubRepositories";
import { plRow } from "../fixtures/vehiclePlRow";

const YM = "2026-05";

function useCase(opts: {
  vehicleCount?: number;
  confirmed?: boolean;
  openFlags?: Parameters<typeof stubReviewFlagRepo>[0];
}) {
  const rows = Array.from({ length: opts.vehicleCount ?? 0 }, (_, i) =>
    plRow({ no: String(i + 1) }),
  );
  return new ConfirmMonthlyPlUseCase(
    stubVehiclePlRepo({ [YM]: rows }, opts.confirmed ? [YM] : []),
    stubReviewFlagRepo(opts.openFlags ?? []),
  );
}

describe("ConfirmMonthlyPlUseCase (業務フロー STEP8 の確定)", () => {
  it("収支表が無い月は確定できない", async () => {
    const status = await useCase({ vehicleCount: 0 }).status(YM);
    expect(status.canConfirm).toBe(false);
    expect(status.isConfirmed).toBe(false);
  });

  it("収支表が無い月に確定しようとするとエラーにする", async () => {
    await expect(useCase({ vehicleCount: 0 }).execute(YM, true)).rejects.toThrow(
      /収支表がありません/,
    );
  });

  it("確定すると全行が確定済みになる", async () => {
    const status = await useCase({ vehicleCount: 3 }).execute(YM, true);
    expect(status.isConfirmed).toBe(true);
    expect(status.confirmedCount).toBe(3);
    expect(status.total).toBe(3);
  });

  it("確定を取り消せる", async () => {
    const uc = useCase({ vehicleCount: 2, confirmed: true });
    expect((await uc.status(YM)).isConfirmed).toBe(true);
    const after = await uc.execute(YM, false);
    expect(after.isConfirmed).toBe(false);
    expect(after.confirmedCount).toBe(0);
  });

  it("未判定の異常値は件数として返す(確定自体はできる)", async () => {
    const status = await useCase({
      vehicleCount: 1,
      openFlags: [
        {
          id: "f1",
          vehicleNo: "1",
          field: "repair",
          type: "digit_suspect",
          severity: "warning",
          message: "桁ミスの疑い",
          status: "open",
        },
      ] as Parameters<typeof stubReviewFlagRepo>[0],
    }).status(YM);
    expect(status.openFlagCount).toBe(1);
    expect(status.canConfirm).toBe(true);
  });
});
