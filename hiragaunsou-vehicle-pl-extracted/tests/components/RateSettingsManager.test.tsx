/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RateSettingsManager } from "../../app/(app)/rate-settings/RateSettingsManager";

const RESOLVED = {
  adminFeeRate: 0.1748,
  tollDiscountRate: 0.356,
  bonusAnnual: 400_000,
  tankPricePerLiter: 120,
  idleSales: 500_000,
  repairSpike: 300_000,
  breakEvenKmPrice: 200,
  kirin_transport_support: 0,
  kirin_management_support: 0,
};

describe("RateSettingsManager の更新頻度別表示", () => {
  it("月ごとに変える3項目だけを最初から表示する", () => {
    render(
      <RateSettingsManager yearMonth="2026-08" initialEntries={[]} resolved={RESOLVED} />,
    );

    const frequentTable = screen.getByRole("table", { name: "よく変える項目" });
    expect(within(frequentTable).getAllByRole("row")).toHaveLength(4);
    expect(within(frequentTable).getByText("インタンク軽油単価")).toBeInTheDocument();
    expect(within(frequentTable).getByText("キリン 輸送協力金(月額)")).toBeInTheDocument();
    expect(within(frequentTable).getByText("キリン 経営支援金(月額)")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "めったに変えない項目" })).not.toBeInTheDocument();
  });

  it("めったに変えない6項目は1クリックしたときだけ表示する", async () => {
    const user = userEvent.setup();
    render(
      <RateSettingsManager yearMonth="2026-08" initialEntries={[]} resolved={RESOLVED} />,
    );

    expect(screen.getByText("6項目")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "めったに変えない項目を開く" }));

    const rareTable = screen.getByRole("table", { name: "めったに変えない項目" });
    expect(within(rareTable).getAllByRole("row")).toHaveLength(7);
    expect(within(rareTable).getByText("一般管理費率")).toBeInTheDocument();
    expect(within(rareTable).getByText("高速組合割引率")).toBeInTheDocument();
    expect(within(rareTable).getByText("賞与 年額")).toBeInTheDocument();
  });

  /**
   * 下に貼り付く保存の帯は「画面の最後の要素」である前提で下余白を打ち消している。
   * 後ろに要素が続くと、その要素が帯の下へ食い込んで読めなくなる
   * (「率を保存して収支表を作り直す」と「各項目の意味と…」の折りたたみが重なった)。
   */
  it("保存の帯を画面の最後に置き、説明の折りたたみを帯の後ろに残さない", () => {
    const { container } = render(
      <RateSettingsManager yearMonth="2026-08" initialEntries={[]} resolved={RESOLVED} />,
    );

    const bar = container.querySelector(".screen-action-bar")!;
    expect(bar).toBeInTheDocument();
    expect(bar.parentElement!.lastElementChild).toBe(bar);
    // 説明の折りたたみは帯より前にあること
    const disclosure = screen.getByText("各項目の意味と、月別値・共通値の使い分けを見る");
    expect(bar.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});
