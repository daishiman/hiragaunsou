/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockPathname = "/dashboard";
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: mockRefresh }),
}));

const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn(async () => {}) }));
vi.mock("../../app/_lib/authClient", () => ({
  signOut: signOutMock,
}));

import { AppShell } from "../../app/_components/AppShell";

/** サイドバーのメインメニューに限定してクエリする(フッターにも同名リンクが重複するため)。 */
function mainNav() {
  return within(screen.getByRole("navigation", { name: "メインメニュー" }));
}

describe("AppShell", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
    mockPush.mockClear();
    mockReplace.mockClear();
    mockRefresh.mockClear();
    signOutMock.mockClear();
  });

  it("admin(role)ではAI設定など管理権限限定の項目もサイドバーに表示する", () => {
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
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
        badges={{ registration: 3, anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("ヘッダーに年月度の表示を出さない(利用者を混乱させるため削除済み)", () => {
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ registration: 0, anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(screen.queryByText(/\d{4}年\d{1,2}月度/)).not.toBeInTheDocument();
  });

  it("ユーザー名・ロールを表示し、子要素をmain内に描画する", () => {
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
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

  it("ユーザー名はマイページへのリンクになっている", () => {
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ registration: 0, anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: /今西さん/ })).toHaveAttribute("href", "/profile");
  });

  it("ログアウトボタンを押すとsignOutを呼びsign-inへ遷移する", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ registration: 0, anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/sign-in");
  });
});
