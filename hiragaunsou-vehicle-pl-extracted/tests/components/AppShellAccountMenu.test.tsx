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
import { visibleAccountGroups, visibleNavGroups } from "../../app/_lib/navigation";

function renderShell(role = "admin") {
  return render(
    <AppShell userName="今西さん" userRole="管理者" role={role} badges={{ anomaly: 0 }}>
      <p>本文</p>
    </AppShell>,
  );
}

function trigger() {
  return screen.getByRole("button", { name: /今西さん/ });
}

/**
 * 依頼者の指示 (2026-08-09):
 *   「アカウント管理のサイドバーは、アカウント名をクリックしたら表示する仕様にしてほしい」
 *
 * 月1回も開かない運用・設定・仕様書の画面をここへ集める。開くのに1クリック増えるが、
 * サイドバーから常時見える選択肢を減らす対価としては見合う (docs/design-system.md §11-9)。
 */
describe("アカウントメニュー", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
    window.localStorage.clear();
  });

  it("既定では閉じており、ユーザー名を押すと開く", async () => {
    const user = userEvent.setup();
    renderShell();

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger());

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "マイページ" })).toHaveAttribute("href", "/profile");
  });

  it("アカウントに属する画面とログアウトが入っている", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(trigger());

    const menu = within(screen.getByRole("menu"));
    for (const group of visibleAccountGroups("admin")) {
      for (const item of group.items) {
        expect(menu.getByRole("menuitem", { name: item.label })).toHaveAttribute("href", item.href);
      }
    }
    expect(menu.getByRole("menuitem", { name: "ログアウト" })).toBeInTheDocument();
  });

  it("Escで閉じ、フォーカスがユーザー名に戻る", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(trigger());

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("外側をクリックすると閉じる", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(trigger());

    await user.click(screen.getByText("本文"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("キーボードだけで開き、上下キーで項目を移動できる", async () => {
    const user = userEvent.setup();
    renderShell();

    trigger().focus();
    await user.keyboard("{ArrowDown}");

    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(items[0]).toHaveFocus();

    // 先頭で上を押すと末尾（ログアウト）へ回り込む
    await user.keyboard("{ArrowUp}");
    expect(items[items.length - 1]).toHaveFocus();
  });

  it("上キーで開くと末尾のログアウトにフォーカスが当たる", async () => {
    const user = userEvent.setup();
    renderShell();

    trigger().focus();
    await user.keyboard("{ArrowUp}");

    expect(screen.getByRole("menuitem", { name: "ログアウト" })).toHaveFocus();
  });

  it("メニュー内の画面を開いているときは、閉じていても現在地がユーザー名の下に出る", () => {
    mockPathname = "/profile";
    renderShell();

    expect(within(trigger()).getByText("マイページ")).toBeInTheDocument();
  });
});

/**
 * 「サイドバーから消す項目は必ず別の場所から到達できるようにし、到達不能な画面が
 * 1つも無いこと」を固定する。ここが崩れると、実装済みなのに誰も辿り着けない画面ができる。
 */
describe("メニューから辿れない画面を作らない", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  for (const role of ["admin", "input_staff", "executive"]) {
    it(`${role} が開ける画面はすべてサイドバーかアカウントメニューから辿れる`, async () => {
      mockPathname = "/dashboard";
      const user = userEvent.setup();
      renderShell(role);

      const sidebarHrefs = new Set(
        screen
          .getAllByRole("link")
          .map((el) => el.getAttribute("href")?.split("?")[0] ?? ""),
      );

      await user.click(trigger());
      const menuHrefs = new Set(
        within(screen.getByRole("menu"))
          .getAllByRole("menuitem")
          .map((el) => el.getAttribute("href")?.split("?")[0] ?? ""),
      );

      const expected = [...visibleNavGroups(role), ...visibleAccountGroups(role)].flatMap(
        (g) => g.items,
      );
      expect(expected.length).toBeGreaterThan(0);
      for (const item of expected) {
        expect(
          sidebarHrefs.has(item.href) || menuHrefs.has(item.href),
          `${role}: ${item.href} に辿り着けない`,
        ).toBe(true);
      }
    });
  }
});
