/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ManualEntryStepper,
  parseSumExpression,
  type PrefillValues,
} from "../../app/(app)/manual-entry/ManualEntryStepper";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const prefill: PrefillValues = {
  repairActual: {},
  fuelOut: {},
  fuelOutQty: {},
  fuelInQty: {},
  adblue: {},
  equip: {},
  mainte: {},
  miscOther: {},
  tankPricePerLiter: 130,
};

const vehicles = [
  { vehicleNo: "24", driver: "山田" },
  { vehicleNo: "300", driver: "佐藤" },
];

function setupFetchMock() {
  // 初回マウント時の読み戻しGET(/api/manual-entry?...)は空を返す
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (!init || init.method === undefined) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ manualInputs: [], kirinTargetVehicleNos: [] }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

describe("parseSumExpression", () => {
  it("足し算式・全角数字・カンマを合計して数値化する", () => {
    expect(parseSumExpression("1200+340+560")).toBe(2100);
    expect(parseSumExpression("１、２００")).toBe(1200);
    expect(parseSumExpression("")).toBeNull();
    expect(parseSumExpression("abc")).toBeNull();
  });
});

describe("ManualEntryStepper", () => {
  beforeEach(() => {
    global.fetch = setupFetchMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ステップレールをクリックすると直接該当ステップへ遷移し、キリン配分の結果が金額入力に応じて変わる", async () => {
    const user = userEvent.setup();
    render(
      <ManualEntryStepper
        yearMonth="2026-05"
        vehicles={vehicles}
        prefill={prefill}
        payrollStatus={null}
      />,
    );

    // 初期は STEP2「キリンの協力金」
    expect(screen.getByRole("heading", { name: "キリンの輸送協力金・経営支援金" })).toBeInTheDocument();

    // 輸送協力金と経営支援金の2つのinputがあるため、最初の要素を取得
    const inputs = screen.getAllByPlaceholderText("1200+340");
    await user.type(inputs[0]!, "1000+1000");

    // 配分先(既定は24,300の2台)への割り当て額が更新される -> 2000/2=1000円
    expect(await screen.findByText("1,000")).toBeInTheDocument();

    // ステップレールの「燃料費」をクリックすると、その場でSTEP3に飛べる
    await user.click(screen.getByRole("button", { name: /燃料費/ }));
    expect(screen.getByRole("heading", { name: "燃料費" })).toBeInTheDocument();
  });

  it("最終ステップで「収支表を作り直す」を押すと送信中は連打できず、成功後に次のステップへの導線が表示される", async () => {
    const user = userEvent.setup();
    // POST /api/manual-entry だけ手動で解決を制御し、送信中(pending)状態を確実に観測できるようにする。
    let resolvePost!: (value: Response) => void;
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ manualInputs: [], kirinTargetVehicleNos: [] }),
        } as Response);
      }
      return new Promise<Response>((resolve) => {
        resolvePost = resolve;
      });
    });

    render(
      <ManualEntryStepper
        yearMonth="2026-05"
        vehicles={vehicles}
        prefill={prefill}
        payrollStatus={{ fileName: "payroll.csv", rowCount: 2, importedAt: Date.now() }}
      />,
    );

    // 「次へ」を5回押して最終ステップ(確認して確定)まで進む(STEPSは6項目)
    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByRole("button", { name: "次へ" }));
    }

    expect(screen.getByRole("heading", { name: "確認して確定" })).toBeInTheDocument();

    const submitButton = screen.getByRole("button", { name: "収支表を作り直す" });
    await user.click(submitButton);

    // 送信中は「計算しています…」表示になり、ボタンはdisabledで連打できない
    const pendingButton = await screen.findByRole("button", { name: "計算しています…" });
    expect(pendingButton).toBeDisabled();

    resolvePost({ ok: true, json: async () => ({}) } as Response);

    await waitFor(() => {
      expect(
        screen.getByText("収支表を作り直しました。月次収支表に反映されています。"),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /次へ: 収支表のチェックに進む/ })).toHaveAttribute(
      "href",
      "/anomaly?ym=2026-05",
    );
  });

  it("保存に失敗するとエラーメッセージを表示する", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ manualInputs: [], kirinTargetVehicleNos: [] }),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: "保存できませんでした(サーバーエラー)" }),
      } as Response);
    });

    render(
      <ManualEntryStepper
        yearMonth="2026-05"
        vehicles={vehicles}
        prefill={prefill}
        payrollStatus={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "ここまでを保存" }));

    expect(await screen.findByText("保存できませんでした(サーバーエラー)")).toBeInTheDocument();
  });
});
