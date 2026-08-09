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

  it("admin(role)では管理権限限定の項目もメニューに表示する", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(mainNav().getByRole("link", { name: /^データ取込/ })).toBeInTheDocument();
    // AI設定は運用の画面なのでサイドバーではなくアカウントメニューの中にある
    expect(mainNav().queryByRole("link", { name: "AI設定" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /今西さん/ }));
    expect(screen.getByRole("menuitem", { name: "AI設定" })).toBeInTheDocument();
  });

  it("executive(role)では入力系・管理系の権限限定項目をメニューから除く", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        userName="社長"
        userRole="経営者"
        role="executive"
        badges={{ anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(mainNav().queryByRole("link", { name: /^データ取込/ })).not.toBeInTheDocument();
    expect(mainNav().queryByRole("link", { name: /^手入力/ })).not.toBeInTheDocument();
    // view権限のみの画面は引き続き見える
    expect(mainNav().getByRole("link", { name: /^ダッシュボード/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /社長/ }));
    expect(screen.queryByRole("menuitem", { name: "AI設定" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "利用状況" })).toBeInTheDocument();
  });

  it("現在地のパスに一致するリンクにaria-current=pageを付ける", () => {
    mockPathname = "/dashboard";
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    expect(mainNav().getByRole("link", { name: /^ダッシュボード/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(mainNav().getByRole("link", { name: /^データ取込/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("未判定の件数だけをバッジに出し、0件のときは出さない", () => {
    const { unmount } = render(
      <AppShell userName="今西さん" userRole="管理者" role="admin" badges={{ anomaly: 3 }}>
        <p>本文</p>
      </AppShell>,
    );
    expect(within(mainNav().getByRole("link", { name: /^チェック/ })).getByText("3")).toBeInTheDocument();
    unmount();

    render(
      <AppShell userName="今西さん" userRole="管理者" role="admin" badges={{ anomaly: 0 }}>
        <p>本文</p>
      </AppShell>,
    );
    expect(mainNav().getByRole("link", { name: /^チェック/ })).toHaveTextContent(/^チェック（1件ずつ）$/);
  });

  /**
   * 依頼者の指示 (2026-08-09): 「これが無いと何が分からなくなるか」に答えられない数字は出さない。
   * 登録済み台数は見ても次にやることが変わらないため廃止した。
   */
  it("データ取込に登録台数のバッジを出さない", () => {
    render(
      <AppShell userName="今西さん" userRole="管理者" role="admin" badges={{ anomaly: 0 }}>
        <p>本文</p>
      </AppShell>,
    );
    expect(mainNav().getByRole("link", { name: /^データ取込/ })).toHaveTextContent(/^データ取込$/);
  });

  it("ヘッダーに年月度の表示を出さない(利用者を混乱させるため削除済み)", () => {
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ anomaly: 0 }}
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
        badges={{ anomaly: 0 }}
      >
        <p>ここが本文</p>
      </AppShell>,
    );
    expect(screen.getByText("今西さん")).toBeInTheDocument();
    expect(screen.getByText("管理者")).toBeInTheDocument();
    expect(screen.getByText("ここが本文")).toBeInTheDocument();
  });

  // ボタンは見た目こそアイコンだが、名前は必ず「何が起きるか」を動詞で持つ。
  // 名前で引けること自体が、読み上げ・ツールチップで意味に辿り着ける保証になる。
  it("狭い画面のメニューボタンを押すと開閉状態(aria-expanded)が切り替わり、名前も入れ替わる", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    const openButton = screen.getByRole("button", { name: "メニューを開く" });
    expect(openButton).toHaveAttribute("aria-expanded", "false");
    await user.click(openButton);
    const closeButton = screen.getByRole("button", { name: "メニューを閉じる" });
    expect(closeButton).toHaveAttribute("aria-expanded", "true");
  });

  it("ユーザー名はアカウントメニューを開くボタンになっている", () => {
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    const trigger = screen.getByRole("button", { name: /今西さん/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // マイページはメニューを開くまで出さない
    expect(screen.queryByRole("link", { name: "マイページ" })).not.toBeInTheDocument();
  });

  it("アカウントメニューのログアウトを押すとsignOutを呼びsign-inへ遷移する", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: /今西さん/ }));
    await user.click(screen.getByRole("menuitem", { name: "ログアウト" }));
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/sign-in");
  });

  it("業務フローのSTEP番号バッジをサイドバーに表示しない(初心者に分かりにくいため廃止済み)", () => {
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    // 「データ取込」「データ整形」「手入力」「チェック」等のリンクにSTEP番号(1・2・4・7のような数字)が付随しない
    const importLink = mainNav().getByRole("link", { name: /^データ取込/ });
    expect(importLink).toHaveTextContent(/^データ取込$/);
    const cleansingLink = mainNav().getByRole("link", { name: "データ整形" });
    expect(cleansingLink).toHaveTextContent(/^データ整形$/);
  });

  it("ホームリンクにホバーするとカスタムツールチップで説明が出る", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    // ホームリンクはメインメニュー(<nav>)の外、サイドバー上部に単独で配置されている
    // (アクセシブルネームは「ホーム まずはここ」のバッジ文言も含む)
    const homeLink = screen.getByRole("link", { name: /^ホーム/ });
    expect(homeLink).not.toHaveAttribute("title");

    await user.hover(homeLink);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("今やることを1つだけ案内します。まずはここから");

    await user.unhover(homeLink);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("ホームリンクは連続ホバーしても毎回ツールチップが再表示される(ネイティブtitleのクールダウンを回避)", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    const homeLink = screen.getByRole("link", { name: /^ホーム/ });

    await user.hover(homeLink);
    await screen.findByRole("tooltip");
    await user.unhover(homeLink);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // 1回目を閉じた直後の再ホバーでも表示される
    await user.hover(homeLink);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("今やることを1つだけ案内します。まずはここから");
  });

  it("サイドバーのメニュー項目にホバーするとカスタムツールチップで説明が出る", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        userName="今西さん"
        userRole="管理者"
        role="admin"
        badges={{ anomaly: 0 }}
      >
        <p>本文</p>
      </AppShell>,
    );
    const importLink = mainNav().getByRole("link", { name: /^データ取込/ });
    expect(importLink).not.toHaveAttribute("title");

    await user.hover(importLink);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBeTruthy();
  });
});
