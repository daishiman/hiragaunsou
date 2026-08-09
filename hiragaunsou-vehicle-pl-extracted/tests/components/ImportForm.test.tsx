/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace, push: vi.fn() }),
}));

import { describePlRebuild, ImportForm } from "../../app/(app)/import/ImportForm";
import {
  evaluateFileImport,
  type DuplicateFinding,
} from "../../src/domain/rules/fileImportCheck";

/** 対象帳票の見出しから、その帳票専用のファイル選択inputを取り出す */
function fileInputFor(headingName: string): HTMLInputElement {
  const heading = screen.getByRole("heading", { name: headingName });
  const container = heading.closest("section");
  if (!container) throw new Error(`section not found for ${headingName}`);
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error(`file input not found for ${headingName}`);
  return input as HTMLInputElement;
}

/**
 * 取込前の下読み(POST /api/import/detect)の応答。
 * 判定結果の文言と「止める/通す」はサーバーと同じ純関数で作り、画面側の分岐だけを試す。
 */
function detectResponse(
  yearMonth: string | null,
  basis: string,
  options: {
    expectedYearMonth?: string;
    detectedSourceType?: string;
    duplicate?: DuplicateFinding | null;
  } = {},
): Response {
  const candidates = yearMonth ? [yearMonth] : [];
  const verdict = evaluateFileImport({
    screen: "import",
    acceptedSourceTypes: ["vehicle_operation"],
    expectedLabel: "車両別運行実績表",
    detectedSourceType: options.detectedSourceType ?? "vehicle_operation",
    expectedYearMonth: options.expectedYearMonth ?? "2026-05",
    detectedYearMonth: yearMonth,
    yearMonthBasis: basis,
    yearMonthCandidates: candidates,
    missingColumns: [],
    rowCount: 10,
    duplicate: options.duplicate ?? null,
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      sourceType: options.detectedSourceType ?? "vehicle_operation",
      contentHash: "abc123",
      yearMonth,
      basis,
      candidates,
      verdict,
    }),
  } as Response;
}

describe("ImportForm", () => {
  beforeEach(() => {
    refresh.mockClear();
    replace.mockClear();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("中身の年月が対象年月と一致すれば確認を挟まず取り込み、判定根拠を残す", async () => {
    const user = userEvent.setup();
    let resolveUpload!: (value: Response) => void;
    const uploadPromise = new Promise<Response>((resolve) => {
      resolveUpload = resolve;
    });
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(detectResponse("2026-05", "「計上日」の日付10件のうち10件が2026年5月でした。"))
      .mockReturnValueOnce(uploadPromise);

    render(<ImportForm yearMonth="2026-05" imported={{}} />);

    const input = fileInputFor("車両別運行実績表");
    const file = new File(["a,b,c"], "operation.csv", { type: "text/csv" });
    await user.upload(input, file);

    expect(await screen.findByText("取り込んでいます…")).toBeInTheDocument();

    resolveUpload({
      ok: true,
      status: 200,
      json: async () => ({ vehicleCount: 12, charteredExcluded: 1 }),
    } as Response);

    expect(
      await screen.findByText(
        /operation\.csv: 2026年5月分として取り込みました（車両 12 台 ／ 傭車 1 件を除外）/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("「計上日」の日付10件のうち10件が2026年5月でした。"),
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenNthCalledWith(1, "/api/import/detect", expect.anything());
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "/api/import/vehicle_operation",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("中身に年月が無いファイルは何年何月分かを利用者に選ばせてから取り込む", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        detectResponse(null, "この帳票には日付が書かれていないため、中身から年月を判定できません。"),
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ totalRows: 87 }),
      } as Response);

    render(<ImportForm yearMonth="2026-05" imported={{}} />);

    const input = fileInputFor("車両別運行実績表");
    const file = new File(["a,b,c"], "operation.csv", { type: "text/csv" });
    await user.upload(input, file);

    expect(await screen.findByText("この取込は何年何月分ですか?")).toBeInTheDocument();
    expect(
      screen.getByText("この帳票には日付が書かれていないため、中身から年月を判定できません。"),
    ).toBeInTheDocument();
    // 判定できないときは画面で選んでいる対象年月が初期値になる
    expect((screen.getByLabelText("取り込む年月") as HTMLSelectElement).value).toBe("2026-05");

    await user.click(screen.getByRole("button", { name: "2026年5月分として取り込む" }));

    expect(
      await screen.findByText(/operation\.csv: 2026年5月分として取り込みました/),
    ).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("中身の年月が対象年月と違うときは、その月を初期値にした確認を出す", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        detectResponse("2026-04", "「計上日」の日付10件のうち10件が2026年4月でした。"),
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ totalRows: 5 }),
      } as Response);

    render(<ImportForm yearMonth="2026-05" imported={{}} />);

    const input = fileInputFor("車両別運行実績表");
    const file = new File(["a,b,c"], "operation.csv", { type: "text/csv" });
    await user.upload(input, file);

    expect(await screen.findByText("この取込は何年何月分ですか?")).toBeInTheDocument();
    expect((screen.getByLabelText("取り込む年月") as HTMLSelectElement).value).toBe("2026-04");

    await user.click(screen.getByRole("button", { name: "2026年4月分として取り込む" }));

    // 見ている月と違う月に取り込んだので、その月の取込状況へ切り替える
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/import?ym=2026-04"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("同じ帳票が取込済みのときは入れ直し確認を出し、承認すると置き換えて取込む", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(detectResponse("2026-05", "シート「5月収支表」の見出しから2026年5月分と判定しました。"))
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          conflict: {
            sameFileName: true,
            superseded: [{ fileName: "operation.csv", rowCount: 10, importedAt: Date.now() }],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ vehicleCount: 12 }),
      } as Response);

    render(<ImportForm yearMonth="2026-05" imported={{}} />);

    const input = fileInputFor("車両別運行実績表");
    const file = new File(["a,b,c"], "operation.csv", { type: "text/csv" });
    await user.upload(input, file);

    expect(
      await screen.findByText("「operation.csv」は既に取り込み済みです。入れ直しますか?"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "削除して入れ直す" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenNthCalledWith(
        3,
        "/api/import/vehicle_operation",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(
      await screen.findByText(/operation\.csv: 2026年5月分として取り込みました/),
    ).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("前に取り込んだファイルと中身が同じなら、取込前に知らせて確認を取る", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        detectResponse("2026-05", "「計上日」の日付10件のうち10件が2026年5月でした。", {
          duplicate: {
            match: "sameContentSameName",
            fileName: "operation.csv",
            importedAt: Date.now(),
            rowCount: 10,
            yearMonth: "2026-05",
          },
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ vehicleCount: 12 }),
      } as Response);

    render(<ImportForm yearMonth="2026-05" imported={{}} />);

    await user.upload(
      fileInputFor("車両別運行実績表"),
      new File(["a,b,c"], "operation.csv", { type: "text/csv" }),
    );

    // 二重取込は黙って通さず、いつ取り込んだかを添えて確認する
    expect(
      await screen.findByText(/に取り込み済みです/),
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "それでも取り込む" }));

    expect(
      await screen.findByText(/operation\.csv: 2026年5月分として取り込みました/),
    ).toBeInTheDocument();
  });

  it("サーバーに接続できない場合は通信エラーメッセージを表示し、一覧は更新しない", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(detectResponse("2026-05", "シート「5月収支表」の見出しから2026年5月分と判定しました。"))
      .mockRejectedValueOnce(new Error("offline"));

    render(<ImportForm yearMonth="2026-05" imported={{}} />);

    const input = fileInputFor("車両別運行実績表");
    const file = new File(["a,b,c"], "operation.csv", { type: "text/csv" });
    await user.upload(input, file);

    expect(
      await screen.findByText((_, element) =>
        element?.tagName === "P" && (element.textContent ?? "").includes("サーバーに接続できませんでした"),
      ),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("下読み自体が失敗しても行き止まりにせず、年月を選んで取り込める", async () => {
    const user = userEvent.setup();
    (global.fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ totalRows: 3 }),
      } as Response);

    render(<ImportForm yearMonth="2026-05" imported={{}} />);

    const input = fileInputFor("車両別運行実績表");
    const file = new File(["a,b,c"], "operation.csv", { type: "text/csv" });
    await user.upload(input, file);

    expect(await screen.findByText("この取込は何年何月分ですか?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2026年5月分として取り込む" }));
    expect(
      await screen.findByText(/operation\.csv: 2026年5月分として取り込みました/),
    ).toBeInTheDocument();
  });
});

/**
 * 取込は成功したが収支表が作れなかったときの見せ方。
 * 「0台分作りました」で終わらせると、利用者は取込をやり直すしかなくなる(やり直しても変わらない)。
 * 真因を名指しし、直しに行く先まで出ることを固定する。
 */
describe("describePlRebuild(収支表の下地づくりの結果表示)", () => {
  it("車両マスタが空のときは、作れない理由と直しに行く先を返す", () => {
    const result = describePlRebuild({ status: "skipped", reason: "no_vehicle_master" });
    expect(result.text).toContain("車両マスタに車両が1台も登録されていない");
    expect(result.fix).toEqual({ href: "/admin/vehicle-master", label: "車両マスタを登録する" });
  });

  it("作れたときは台数を伝え、直しに行く先は出さない", () => {
    const result = describePlRebuild({ status: "built", vehicleCount: 106 });
    expect(result.text).toContain("106 台分");
    expect(result.fix).toBeUndefined();
  });

  it("材料不足・確定済みはそれぞれの理由を伝える", () => {
    expect(describePlRebuild({ status: "skipped", reason: "imports_incomplete" }).text).toContain(
      "運行実績と売上の両方",
    );
    expect(describePlRebuild({ status: "skipped", reason: "confirmed" }).text).toContain("確定済み");
  });
});
