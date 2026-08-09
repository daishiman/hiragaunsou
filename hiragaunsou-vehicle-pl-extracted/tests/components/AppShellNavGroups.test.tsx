/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let mockPathname = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("../../app/_lib/authClient", () => ({ signOut: vi.fn(async () => {}) }));

import { AppShell } from "../../app/_components/AppShell";
import { visibleNavGroups, visibleAccountGroups } from "../../app/_lib/navigation";

function renderShell(role = "admin") {
  return render(
    <AppShell userName="今西さん" userRole="管理者" role={role} badges={{ anomaly: 0 }}>
      <p>本文</p>
    </AppShell>,
  );
}

function mainNav() {
  return within(screen.getByRole("navigation", { name: "メインメニュー" }));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 依頼者の指示 (2026-08-09):
 *   「サイドバーに情報が膨大にありすぎて認知負荷が高い」「閉じたときの件数は不要」
 *   「絶対にこの情報が無いと分からない、という情報だけを表示してほしい」
 *
 * 折りたたみは廃止した。畳めば中の画面が2クリックになり、毎月の締めで何度も往復する
 * 画面が遠くなる。「画面に集中したい」にはサイドバーごと隠すトグルで応える。
 */
describe("サイドバーのグループ表示", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
    window.localStorage.clear();
  });

  it("グループ見出しは押せるボタンではなく、中の項目は常に見えている", () => {
    renderShell();
    expect(mainNav().queryByRole("button")).not.toBeInTheDocument();
    expect(mainNav().getByRole("link", { name: /^ダッシュボード/ })).toBeInTheDocument();
    expect(mainNav().getByRole("link", { name: /^データ取込/ })).toBeInTheDocument();
    expect(mainNav().getByRole("link", { name: "率マスタ設定" })).toBeInTheDocument();
  });

  it("グループ見出しの横に項目の件数を出さない", () => {
    renderShell();
    for (const group of visibleNavGroups("admin")) {
      const heading = mainNav().getByText(group.label);
      expect(heading).toHaveTextContent(new RegExp(`^${escapeRegExp(group.label)}$`));
    }
  });

  it("グループ見出しは中の一覧のラベルとして紐づいている", () => {
    renderShell();
    const list = mainNav().getByRole("list", { name: "毎月の締め（この順に進む）" });
    expect(within(list).getByRole("link", { name: /^データ取込/ })).toBeInTheDocument();
  });

  it("運用・設定・仕様書の画面はサイドバーに出さない", () => {
    renderShell();
    for (const group of visibleAccountGroups("admin")) {
      for (const item of group.items) {
        expect(mainNav().queryByRole("link", { name: item.label })).not.toBeInTheDocument();
      }
    }
  });

  it("ホームに「まずはここ」バッジを出さない（位置と色で伝わるため）", () => {
    renderShell();
    expect(screen.queryByText("まずはここ")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ホーム" })).toBeInTheDocument();
  });

  it("各項目にホバーするとカスタムツールチップで説明(desc)が出る", async () => {
    const user = userEvent.setup();
    renderShell();

    const vehicleMasterLink = mainNav().getByRole("link", { name: "車両マスタ管理" });
    expect(vehicleMasterLink).not.toHaveAttribute("title");
    await user.hover(vehicleMasterLink);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/リース料/);
  });
});

/**
 * 依頼者の指示: 「画面のほうだけに専念したいときは隠し、見たいときは表示できるように」。
 * 隠す操作は1操作で戻せ、戻し方 (ボタン) が常に画面上に出ていること。
 */
describe("サイドバーの表示・非表示", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
    window.localStorage.clear();
  });

  it("初期状態では表示されており、ボタンは「隠す」と名乗る", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: "メニューを隠す" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "app-sidebar");
  });

  it("押すと隠れ、戻すボタンが同じ位置に出たままになる", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: "メニューを隠す" }));

    const toggle = screen.getByRole("button", { name: "メニューを表示" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // もう一度押せば元に戻る（1操作で可逆）
    await user.click(toggle);
    expect(screen.getByRole("button", { name: "メニューを隠す" })).toBeInTheDocument();
  });

  it("隠した状態を localStorage に保存し、次に開いたときも維持する", async () => {
    const user = userEvent.setup();
    const { unmount } = renderShell();

    await user.click(screen.getByRole("button", { name: "メニューを隠す" }));
    expect(window.localStorage.getItem("hiragaunsou:sidebar-hidden")).toBe("1");
    unmount();

    renderShell();
    expect(screen.getByRole("button", { name: "メニューを表示" })).toBeInTheDocument();
  });

  it("隠していてもヘッダに現在地の画面名が出たままになる", async () => {
    const user = userEvent.setup();
    mockPathname = "/grid";
    renderShell();

    await user.click(screen.getByRole("button", { name: "メニューを隠す" }));
    // 現在地はサイドバーではなくヘッダに出ているので、隠しても迷子にならない
    expect(within(screen.getByRole("banner")).getByText("月次収支表（1か月・車両ごと）")).toBeInTheDocument();
  });

  it("SPのオフキャンバス用ボタンは別に残っている（狭い画面の挙動を壊さない）", () => {
    renderShell();
    const spButton = screen.getByRole("button", { name: "メニュー" });
    expect(spButton).toHaveAttribute("aria-controls", "app-sidebar");
    expect(spButton).toHaveAttribute("aria-expanded", "false");
  });
});
