/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ManualEntryStepper,
  parsePastedRows,
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

    await user.type(screen.getByLabelText("輸送協力金(円)"), "1000+1000");

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

    resolvePost({ ok: true, json: async () => ({ vehicleCount: 2 }) } as Response);

    await waitFor(() => {
      expect(
        screen.getByText("収支表を作り直しました(2台)。月次収支表に反映されています。"),
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

  // 「高速料金の表に1行も出ない」という報告の再発防止。
  // 原因は検索ではなく車両マスタが0件だったこと。0件のときに理由と次の一手が出ることを固定する。
  it("車両が0台のときは高速料金の表に理由と次の一手を出し、保存・確定を押せなくする", async () => {
    const user = userEvent.setup();
    render(
      <ManualEntryStepper
        yearMonth="2026-05"
        vehicles={[]}
        prefill={prefill}
        payrollStatus={null}
        operatedVehicleCount={73}
        canManageVehicleMaster
      />,
    );

    expect(screen.getByText("この月に入力できる車両がありません")).toBeInTheDocument();
    expect(screen.getByText(/この月の運行実績には73台の車番が記録されています/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ここまでを保存" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /高速料金/ }));
    expect(screen.getByText("入力できる車両がまだありません")).toBeInTheDocument();
    // 上部のバナーと表の中の空状態、どちらからでも登録画面へ行ける
    for (const link of screen.getAllByRole("link", { name: "車両マスタの登録へ" })) {
      expect(link).toHaveAttribute("href", "/admin/vehicle-master");
    }
  });

  it("全角の車番でも検索でき、一致しないときは検索語つきの説明と解除ボタンを出す", async () => {
    const user = userEvent.setup();
    render(
      <ManualEntryStepper
        yearMonth="2026-05"
        vehicles={vehicles}
        prefill={prefill}
        payrollStatus={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /高速料金/ }));
    const search = screen.getByPlaceholderText("車番・運転者で検索");

    // 全角「２４」でも24番がヒットする(NFKC正規化)
    await user.type(search, "２４");
    expect(await screen.findByLabelText("24番の通行料金(円)")).toBeInTheDocument();
    expect(screen.queryByLabelText("300番の通行料金(円)")).not.toBeInTheDocument();

    // 一致0件のときは「マスタが空」ではなく「検索に一致しない」と書き分ける
    await user.clear(search);
    await user.type(search, "999");
    expect(await screen.findByText("「999」に一致する車両がありません")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "絞り込みを解除して全車両を表示" }));
    expect(await screen.findByLabelText("300番の通行料金(円)")).toBeInTheDocument();
  });

  it("ステップを移ると検索の絞り込みを解除する(前のステップの検索語で次の表が空に見えるのを防ぐ)", async () => {
    const user = userEvent.setup();
    render(
      <ManualEntryStepper
        yearMonth="2026-05"
        vehicles={vehicles}
        prefill={prefill}
        payrollStatus={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: /高速料金/ }));
    await user.type(screen.getByPlaceholderText("車番・運転者で検索"), "24");
    expect(screen.queryByLabelText("300番の通行料金(円)")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /燃料費/ }));
    expect(screen.getByPlaceholderText("車番・運転者で検索")).toHaveValue("");
    expect(await screen.findByLabelText("300番の外部給油代(円)")).toBeInTheDocument();
  });

  it("確定しても収支表が0行だったときは成功として見せない", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ manualInputs: [], kirinTargetVehicleNos: [] }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({ vehicleCount: 0 }) } as Response);
    });

    render(
      <ManualEntryStepper
        yearMonth="2026-05"
        vehicles={vehicles}
        prefill={prefill}
        payrollStatus={null}
      />,
    );

    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByRole("button", { name: "次へ" }));
    }
    await user.click(screen.getByRole("button", { name: "収支表を作り直す" }));

    expect(await screen.findByText("収支表は1行も作られませんでした")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /次へ: 収支表のチェックに進む/ })).not.toBeInTheDocument();
  });

  it("保存したキリンの金額を読み戻し、片方だけ直しても0で消えないようにする", async () => {
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            manualInputs: [],
            kirinTargetVehicleNos: ["24", "300"],
            kirin: { transportSupport: 120000, managementSupport: 80000 },
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({ vehicleCount: 2 }) } as Response);
    });

    render(
      <ManualEntryStepper
        yearMonth="2026-05"
        vehicles={vehicles}
        prefill={prefill}
        payrollStatus={null}
      />,
    );

    const inputs = await screen.findByDisplayValue("120000");
    expect(inputs).toBeInTheDocument();
    expect(screen.getByDisplayValue("80000")).toBeInTheDocument();
    // (120000+80000)/2台
    expect(await screen.findByText("100,000")).toBeInTheDocument();
  });
  it("保存済みの0を空欄として読み戻す(一度保存しただけで全車両が入力済みにならない)", async () => {
    const user = userEvent.setup();
    // 保存すると全車両の行が書かれ、入力していない欄には0が入る。
    // その0を値として読み戻すと「未入力のみ」の絞り込みが常に0件になり、表が壊れて見えていた。
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            manualInputs: [
              {
                vehicleNo: "24",
                fuelInQty: 500,
                fuelOut: 0,
                fuelOutQty: 0,
                adblue: 0,
                repairActual: 0,
                tireActual: null,
                equip: 0,
                mainte: 0,
                tollActual: null,
                tollDiscountActual: null,
                miscOther: 0,
              },
              {
                vehicleNo: "300",
                fuelInQty: 0,
                fuelOut: 0,
                fuelOutQty: 0,
                adblue: 0,
                repairActual: 0,
                tireActual: null,
                equip: 0,
                mainte: 0,
                tollActual: null,
                tollDiscountActual: null,
                miscOther: 0,
              },
            ],
            kirinTargetVehicleNos: [],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({ vehicleCount: 2 }) } as Response);
    }) as unknown as typeof fetch;

    render(
      <ManualEntryStepper
        yearMonth="2026-05"
        vehicles={vehicles}
        prefill={prefill}
        payrollStatus={null}
        initialWorkflowStep="3"
      />,
    );

    // 実際に入力した 500 だけが残り、0で保存された欄は空欄に戻る
    expect(await screen.findByDisplayValue("500")).toBeInTheDocument();
    expect(screen.getByLabelText("24番の外部給油代(円)")).toHaveValue("");
    expect(screen.getByLabelText("300番のインタンク給油量(ℓ)")).toHaveValue("");

    // 「入力済み」は実際に入力した1台だけ。「未入力のみ」で残り1台が出る
    expect(screen.getByText(/入力済み 1台/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "未入力のみ" }));
    expect(screen.getByText(/表示 1台 \/ 全 2台/)).toBeInTheDocument();
  });

  it("空欄の欄には自動計算される金額を出す(規則を文章で説明しない)", async () => {
    global.fetch = setupFetchMock() as unknown as typeof fetch;
    render(
      <ManualEntryStepper
        yearMonth="2026-05"
        vehicles={vehicles}
        prefill={prefill}
        payrollStatus={null}
        initialWorkflowStep="6"
        autoValues={{ tireActual: {}, tollActual: { "24": 50000, "300": 20000 } }}
        tollDiscountRate={0.356}
      />,
    );

    // 通行料金の空欄 = 売上モニタリスト由来の金額、割引額の空欄 = それ×組合割引率
    expect(await screen.findByText("自動 50,000")).toBeInTheDocument();
    expect(screen.getByText("自動 17,800")).toBeInTheDocument();
  });

  it("インタンク単価が0のときは警告し、前月の単価をワンタップで引き継げる", async () => {
    const user = userEvent.setup();
    global.fetch = setupFetchMock() as unknown as typeof fetch;
    render(
      <ManualEntryStepper
        yearMonth="2026-05"
        vehicles={vehicles}
        prefill={{ ...prefill, tankPricePerLiter: 0 }}
        payrollStatus={null}
        initialWorkflowStep="3"
        prevTankPricePerLiter={128}
      />,
    );

    expect(
      await screen.findByText("単価が0のままだと、全車の軽油代が0円になります"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "先月と同じ 128 円/ℓ にする" }));
    expect(screen.getByRole("spinbutton")).toHaveValue(128);
  });

  it("備品費・メンテ費の入力欄は出さない(業務フローに対応する手順が無いため)", async () => {
    global.fetch = setupFetchMock() as unknown as typeof fetch;
    render(
      <ManualEntryStepper
        yearMonth="2026-05"
        vehicles={vehicles}
        prefill={prefill}
        payrollStatus={null}
        initialWorkflowStep="5"
      />,
    );

    expect(await screen.findByLabelText("24番の修繕費(円)")).toBeInTheDocument();
    expect(screen.queryByLabelText("24番の備品費(円)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("24番のメンテ費(円)")).not.toBeInTheDocument();
  });
});

describe("parsePastedRows", () => {
  it("タブ区切り・空白区切りのどちらでも車番と金額に分ける", () => {
    expect(parsePastedRows("24\t1200\t3\n300\t900")).toEqual([
      { vehicleNo: "24", values: ["1200", "3"] },
      { vehicleNo: "300", values: ["900"] },
    ]);
    expect(parsePastedRows("24 1200")).toEqual([{ vehicleNo: "24", values: ["1200"] }]);
  });

  it("金額の桁区切りカンマでは分割しない(1,200 を 1 と 200 にしない)", () => {
    expect(parsePastedRows("24\t1,200")).toEqual([{ vehicleNo: "24", values: ["1,200"] }]);
  });

  it("空行と金額のない行は捨てる", () => {
    expect(parsePastedRows("\n24\t1200\n\n300\n")).toEqual([
      { vehicleNo: "24", values: ["1200"] },
    ]);
  });
});
