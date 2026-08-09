/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PayrollStep,
  parseYen,
  type PayrollDetailRow,
  type PayrollDetailSummary,
} from "../../app/(app)/manual-entry/PayrollStep";

function row(overrides: Partial<PayrollDetailRow> = {}): PayrollDetailRow {
  return {
    vehicleNo: "101",
    vehicleType: "4t",
    depot: "本社",
    driverName: "山田太郎",
    driverCount: 1,
    importedSalary: 300000,
    importedWelfare: 40000,
    salary: 300000,
    welfare: 40000,
    salaryOverridden: false,
    welfareOverridden: false,
    overrideValues: {},
    overrideExcluded: false,
    overrideReason: null,
    overrideUpdatedAt: null,
    payrollMatchedCount: 1,
    ...overrides,
  };
}

const healthySummary: PayrollDetailSummary = {
  payrollRowCount: 1,
  driverMasterCount: 1,
  assignedVehicleCount: 1,
  payrollMissingVehicleCount: 0,
};

const importedStatus = { fileName: "5給与集計表.csv", rowCount: 98, importedAt: 1_754_000_000_000 };

function okFetch(body: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body } as Response);
}

/** 取込値のまま(＝人がまだ触っていない)の欄。読み上げにも「取込値」と分かるようになっている。 */
function importedField(label: string): HTMLInputElement {
  return screen.getByLabelText(`${label}(取込値です)`) as HTMLInputElement;
}

/**
 * 欄に入ると値は全選択されるので、そのまま打てば置き換わる。
 * clear してから打つと「取込値に戻る → その後ろに打ち足す」になり、実際の操作と食い違う。
 */
async function retype(
  user: ReturnType<typeof userEvent.setup>,
  el: HTMLInputElement,
  text: string,
) {
  await user.type(el, text, { initialSelectionStart: 0, initialSelectionEnd: el.value.length });
}

describe("parseYen", () => {
  it("カンマ・全角数字を金額として読み、数字以外は読まない", () => {
    expect(parseYen("663,820")).toBe(663820);
    expect(parseYen("６６３８２０")).toBe(663820);
    expect(parseYen("0")).toBe(0);
    expect(parseYen("")).toBeNull();
    expect(parseYen("1200+340")).toBeNull();
    expect(parseYen("abc")).toBeNull();
  });
});

describe("PayrollStep", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("取込値を入力欄に出す(読むだけでなく直せる状態で開く)", () => {
    render(
      <PayrollStep
        yearMonth="2026-05"
        payrollStatus={importedStatus}
        rows={[row()]}
        summary={healthySummary}
      />,
    );

    // 他のタブと同じ作法: 既定値(取込値)は欄の中に薄く入り、印で「取込値のまま」と分かる
    expect(importedField("101番の総支給額(円)")).toHaveValue("300000");
    expect(importedField("101番の社保合計(円)")).toHaveValue("40000");
    expect(importedField("101番の総支給額(円)").className).toContain("text-ink-muted");
  });

  describe("人件費の手修正", () => {
    beforeEach(() => {
      global.fetch = okFetch({ updatedAt: 1_754_100_000_000 });
    });

    it("金額を直して理由を書くと、取込値とは別の直しとして保存する", async () => {
      const user = userEvent.setup();
      render(
        <PayrollStep
          yearMonth="2026-05"
          payrollStatus={importedStatus}
          rows={[row()]}
          summary={healthySummary}
        />,
      );

      await retype(user, importedField("101番の総支給額(円)"), "250000");
      await user.type(screen.getByLabelText(/直した理由/), "月中に車両を乗り換えたため按分");
      await user.click(screen.getByRole("button", { name: "この車両を保存" }));

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toBe("/api/vehicle-pl/override");
      expect(JSON.parse(init.body as string)).toEqual({
        yearMonth: "2026-05",
        vehicleNo: "101",
        excluded: false,
        // 直したのは総支給額だけ。取込値と同じ社保は直しに含めない
        // (含めると取り込み直しても古い値に固定され続ける)。
        values: { salary: 250000 },
        reason: "月中に車両を乗り換えたため按分",
        deferRecalculation: true,
        expectedUpdatedAt: null,
      });
      // 保存後は「手修正」の印が付き、直した値が濃い文字で欄に残る
      expect(await screen.findByText("手修正")).toBeInTheDocument();
      expect(screen.getByLabelText("101番の総支給額(円)")).toHaveValue("250000");
      // 取込値へ戻す入口は行ごとに1つだけ (欄ごとに同じ文言を並べない)
      expect(screen.getAllByRole("button", { name: "取込値に戻す" })).toHaveLength(1);
    });

    it("他の画面で入れた直し(走行距離など)を消さずに持ち回す", async () => {
      const user = userEvent.setup();
      render(
        <PayrollStep
          yearMonth="2026-05"
          payrollStatus={importedStatus}
          rows={[row({ overrideValues: { km: 8000 }, overrideUpdatedAt: 1_754_000_000_000 })]}
          summary={healthySummary}
        />,
      );

      await retype(user, importedField("101番の社保合計(円)"), "38000");
      await user.type(screen.getByLabelText(/直した理由/), "社保の訂正通知があったため");
      await user.click(screen.getByRole("button", { name: "この車両を保存" }));

      const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      const body = JSON.parse(init.body as string) as {
        values: Record<string, number>;
        expectedUpdatedAt: number | null;
      };
      expect(body.values).toEqual({ km: 8000, welfare: 38000 });
      // 先に別の人が直していないかを確かめるため、見ていた時刻を一緒に送る
      expect(body.expectedUpdatedAt).toBe(1_754_000_000_000);
    });

    it("理由が空のままでは保存しない(後から判断を追えなくなるため)", async () => {
      const user = userEvent.setup();
      render(
        <PayrollStep
          yearMonth="2026-05"
          payrollStatus={importedStatus}
          rows={[row()]}
          summary={healthySummary}
        />,
      );

      await retype(user, importedField("101番の総支給額(円)"), "250000");
      await user.click(screen.getByRole("button", { name: "この車両を保存" }));

      expect(global.fetch).not.toHaveBeenCalled();
      expect(screen.getByText(/直した理由を書いてください/)).toBeInTheDocument();
    });

    it("取込値に戻すと直しごと取り消す(元の金額に戻せる)", async () => {
      const user = userEvent.setup();
      render(
        <PayrollStep
          yearMonth="2026-05"
          payrollStatus={importedStatus}
          rows={[
            row({
              salary: 250000,
              salaryOverridden: true,
              overrideValues: { salary: 250000 },
              overrideReason: "按分",
              overrideUpdatedAt: 1_754_000_000_000,
            }),
          ]}
          summary={healthySummary}
        />,
      );

      await user.click(screen.getByRole("button", { name: "取込値に戻す" }));
      await user.click(screen.getByRole("button", { name: "この車両を保存" }));

      const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      // 直しが1つも残らないので、上書きのレコードごと消す
      expect(url).toContain("/api/vehicle-pl/override?yearMonth=2026-05&vehicleNo=101");
      expect(init.method).toBe("DELETE");
      expect(importedField("101番の総支給額(円)")).toHaveValue("300000");
    });

    it("先に別の人が直していたら、上書きせずに開き直すよう伝える", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "衝突", conflict: true }),
      } as Response);
      const user = userEvent.setup();
      render(
        <PayrollStep
          yearMonth="2026-05"
          payrollStatus={importedStatus}
          rows={[row()]}
          summary={healthySummary}
        />,
      );

      await retype(user, importedField("101番の総支給額(円)"), "250000");
      await user.type(screen.getByLabelText(/直した理由/), "按分");
      await user.click(screen.getByRole("button", { name: "この車両を保存" }));

      expect(await screen.findByText(/先に別の人が直しています/)).toBeInTheDocument();
      // 直した値は画面に残す(入力し直させない)
      expect(screen.getByLabelText("101番の総支給額(円)")).toHaveValue("250000");
    });
  });

  describe("0円で並んでいる理由の説明", () => {
    it("給与集計表が未取込なら、その1点だけを名指しする", () => {
      render(
        <PayrollStep
          yearMonth="2026-05"
          payrollStatus={null}
          rows={[row({ driverName: null, driverCount: 0, importedSalary: 0, importedWelfare: 0, salary: 0, welfare: 0, payrollMatchedCount: 0 })]}
          summary={{ payrollRowCount: 0, driverMasterCount: 0, assignedVehicleCount: 0, payrollMissingVehicleCount: 0 }}
        />,
      );

      expect(screen.getByText(/給与集計表がまだ取り込まれていない/)).toBeInTheDocument();
    });

    it("CSVはあるが運転者マスタが空なら、対応表が無いことを名指しする", () => {
      render(
        <PayrollStep
          yearMonth="2026-05"
          payrollStatus={importedStatus}
          rows={[row({ driverName: null, driverCount: 0, importedSalary: 0, importedWelfare: 0, salary: 0, welfare: 0, payrollMatchedCount: 0 })]}
          summary={{ payrollRowCount: 98, driverMasterCount: 0, assignedVehicleCount: 0, payrollMissingVehicleCount: 0 }}
          canManageMasters
        />,
      );

      expect(screen.getByText(/運転者マスタが未登録のため/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "運転者マスタの登録へ" })).toHaveAttribute(
        "href",
        "/admin/driver-master",
      );
    });

    it("運転者は割り当たっているのに給与が見つからない車両は、行の上で名指しする", () => {
      render(
        <PayrollStep
          yearMonth="2026-05"
          payrollStatus={importedStatus}
          rows={[
            row({ vehicleNo: "102", driverName: "退職者", driverCount: 1, payrollMatchedCount: 0, importedSalary: 0, importedWelfare: 0, salary: 0, welfare: 0 }),
          ]}
          summary={{ payrollRowCount: 98, driverMasterCount: 50, assignedVehicleCount: 1, payrollMissingVehicleCount: 1 }}
        />,
      );

      expect(screen.getByText("給与データなし(1人分)")).toBeInTheDocument();
    });

    it("すべて揃っているときは注意書きを出さない(読む量を増やさない)", () => {
      render(
        <PayrollStep
          yearMonth="2026-05"
          payrollStatus={importedStatus}
          rows={[row()]}
          summary={healthySummary}
        />,
      );

      expect(screen.queryByText(/未登録のため/)).not.toBeInTheDocument();
      expect(screen.queryByText(/まだ取り込まれていない/)).not.toBeInTheDocument();
    });
  });

  it("車番・運転者で絞り込める", async () => {
    const user = userEvent.setup();
    render(
      <PayrollStep
        yearMonth="2026-05"
        payrollStatus={importedStatus}
        rows={[row({ vehicleNo: "101" }), row({ vehicleNo: "102", driverName: "鈴木一郎" })]}
        summary={healthySummary}
      />,
    );

    await user.type(screen.getByPlaceholderText("車番・運転者で検索"), "鈴木");

    const table = screen.getByRole("table");
    expect(within(table).queryByText("101")).not.toBeInTheDocument();
    expect(within(table).getByText("102")).toBeInTheDocument();
  });
});
