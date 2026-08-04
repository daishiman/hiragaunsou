/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockPathname = "/dashboard";
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

import { AppShell } from "../../app/_components/AppShell";

/** サイドバーのメインメニューに限定してクエリする(フッターにも同名リンクが重複するため)。 */
function mainNav() {
  return within(screen.getByRole("navigation", { name: "メインメニュー" }));
}

describe("AppShell", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
    mockSearchParams = new URLSearchParams();
  });

  it("admin(role)ではAI設定など管理権限限定の項目もサイドバーに表示する", () => {
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        yearMonth="2026-05"
        badges={{ registration: 0, anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(mainNav().getByRole("link", { name: "AI設定" })).toBeInTheDocument();
    expect(mainNav().getByRole("link", { name: /^データ取込/ })).toBeInTheDocument();
  });

  it("executive(role)では入力系・管理系の権限限定項目をサイドバーから除く", () => {
    render(
      <AppShell
        userName="社長"
        userRole="経営者"
        role="executive"
        yearMonth="2026-05"
        badges={{ registration: 0, anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(mainNav().queryByRole("link", { name: "AI設定" })).not.toBeInTheDocument();
    expect(mainNav().queryByRole("link", { name: /^データ取込/ })).not.toBeInTheDocument();
    expect(mainNav().queryByRole("link", { name: /^手入力/ })).not.toBeInTheDocument();
    // view権限のみの画面は引き続き見える
    expect(mainNav().getByRole("link", { name: "ダッシュボード" })).toBeInTheDocument();
    expect(mainNav().getByRole("link", { name: "利用状況" })).toBeInTheDocument();
  });

  it("現在地のパスに一致するリンクにaria-current=pageを付ける", () => {
    mockPathname = "/dashboard";
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        yearMonth="2026-05"
        badges={{ registration: 0, anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(mainNav().getByRole("link", { name: "ダッシュボード" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(mainNav().getByRole("link", { name: /^データ取込/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("バッジ件数が0より大きいときだけ件数を表示する", () => {
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        yearMonth="2026-05"
        badges={{ registration: 3, anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("?ymが未指定のときはpropsのyearMonthをヘッダーに表示する", () => {
    mockSearchParams = new URLSearchParams();
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        yearMonth="2026-05"
        badges={{ registration: 0, anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(screen.getByText("2026年5月度")).toBeInTheDocument();
  });

  it("正しい形式の?ymがあればそちらをヘッダーに表示する", () => {
    mockSearchParams = new URLSearchParams("ym=2026-03");
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        yearMonth="2026-05"
        badges={{ registration: 0, anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(screen.getByText("2026年3月度")).toBeInTheDocument();
  });

  it("不正な形式の?ymは無視してpropsのyearMonthを使う", () => {
    mockSearchParams = new URLSearchParams("ym=invalid");
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        yearMonth="2026-05"
        badges={{ registration: 0, anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(screen.getByText("2026年5月度")).toBeInTheDocument();
  });

  it("ユーザー名・ロールを表示し、子要素をmain内に描画する", () => {
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        yearMonth="2026-05"
        badges={{ registration: 0, anomaly: 0 }}
      >
        <p>ここが本文</p>
      </AppShell>,
    );
    expect(screen.getByText("今西さん")).toBeInTheDocument();
    expect(screen.getByText("管理者")).toBeInTheDocument();
    expect(screen.getByText("ここが本文")).toBeInTheDocument();
  });

  it("SPのメニューボタンを押すとサイドバーの開閉状態(aria-expanded)が切り替わる", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        yearMonth="2026-05"
        badges={{ registration: 0, anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    const menuButton = screen.getByRole("button", { name: "メニュー" });
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await user.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
  });
});
