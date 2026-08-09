/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ScreenHeader } from "../../app/_components/ScreenHeader";
import { getScreen } from "../../app/_lib/screens";

/**
 * 「データ整形」「手入力」「チェック」がどれも同じに見える、という指摘への対策。
 * 3行(すること / 見ないこと / 次に)が同じ位置に必ず出ることを、画面ごとではなくここで固定する。
 */
describe("ScreenHeader", () => {
  it("定義ファイルの見出し・リード文をそのまま描く(ページ側は画面パスを渡すだけ)", () => {
    const def = getScreen("/cleansing")!;
    render(<ScreenHeader screen="/cleansing" />);
    expect(screen.getByRole("heading", { level: 1, name: def.title })).toBeInTheDocument();
    expect(screen.getByText(def.lead)).toBeInTheDocument();
  });

  it("役割ノートに「この画面ですること」「ここでは見ないこと」「終わったら次に」が並ぶ", () => {
    render(<ScreenHeader screen="/cleansing" />);
    const note = screen.getByLabelText("この画面の役割");
    expect(within(note).getByText("この画面ですること")).toBeInTheDocument();
    expect(within(note).getByText("ここでは見ないこと")).toBeInTheDocument();
    expect(within(note).getByText("終わったら次に")).toBeInTheDocument();
  });

  it("毎月の締めの画面では、工程の何番目かと前後の画面が出る", () => {
    render(<ScreenHeader screen="/manual-entry" />);
    const note = screen.getByLabelText("この画面の役割");
    expect(note.textContent).toContain("毎月の締め");
    expect(within(note).getByRole("link", { name: getScreen("/cleansing")!.label })).toBeInTheDocument();
    expect(within(note).getByRole("link", { name: getScreen("/anomaly")!.label })).toBeInTheDocument();
  });

  it("工程外の画面では工程番号を出さない(関係のない順番を見せない)", () => {
    render(<ScreenHeader screen="/dashboard" />);
    const note = screen.getByLabelText("この画面の役割");
    expect(note.textContent).not.toContain("毎月の締め ");
  });

  it("対象月や車番を含む見出しだけは上書きできる", () => {
    render(<ScreenHeader screen="/vehicle" title="車番 1234" lead="2026年3月" />);
    expect(screen.getByRole("heading", { level: 1, name: "車番 1234" })).toBeInTheDocument();
    expect(screen.getByText("2026年3月")).toBeInTheDocument();
  });

  it("未登録の画面でも見出しだけは描いて落ちない", () => {
    render(<ScreenHeader screen="/no-such-page" title="未登録" />);
    expect(screen.getByRole("heading", { level: 1, name: "未登録" })).toBeInTheDocument();
    expect(screen.queryByLabelText("この画面の役割")).not.toBeInTheDocument();
  });
});
