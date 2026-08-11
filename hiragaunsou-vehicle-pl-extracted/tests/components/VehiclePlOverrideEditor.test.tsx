/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { VehiclePlOverrideEditor } from "../../app/(app)/vehicle/[vehicleNo]/VehiclePlOverrideEditor";
import { OVERRIDABLE_FIELDS } from "../../src/domain/rules/vehiclePlOverride";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("VehiclePlOverrideEditor", () => {
  // 高負荷環境(Rosetta等)で jsdom + NumberEntryField の初回描画が 5s を超えることがある。
  // 契約検証そのものは軽量なので、タイムアウトだけ広げる。
  it(
    "単一車両の入力を横表ではなく、狭幅で縦に積む定義リストとして表示する",
    () => {
      const { container } = render(
        <VehiclePlOverrideEditor
          yearMonth="2026-08"
          vehicleNo="10"
          currentValues={{ fare: 1_050_000, km: 2_500 }}
          saved={{
            excluded: false,
            values: { fare: 900_000 },
            reason: "請求側で減額したため",
            updatedAt: "2026-08-11T00:00:00.000Z",
            updatedByName: "管理者",
          }}
        />,
      );

      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      const details = container.querySelector("dl");
      expect(details).toHaveClass("[&>div]:grid-cols-1");
      expect(within(details!).getAllByRole("textbox")).toHaveLength(OVERRIDABLE_FIELDS.length);
      expect(screen.getByRole("textbox", { name: "運賃(円)" })).toHaveValue("900000");
      expect(screen.getByText("出どころ：上書き済み ／ 単位：円")).toBeInTheDocument();
      expect(screen.getByText("出どころ：運行実績CSV ／ 単位：km")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "直した理由（必須）" })).toHaveValue(
        "請求側で減額したため",
      );
      expect(screen.getByText("翌月に同じ手直しをするか判定するために残します。")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "保存して収支表を作り直す" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "上書きを取り消して元に戻す" })).toBeInTheDocument();
    },
    30_000,
  );
});
