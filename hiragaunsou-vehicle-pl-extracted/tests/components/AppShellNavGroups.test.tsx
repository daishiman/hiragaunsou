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

function renderShell() {
  return render(
    <AppShell userName="今西さん" userRole="管理者" role="admin" badges={{ registration: 0, anomaly: 0 }}>
      <p>本文</p>
    </AppShell>,
  );
}

function mainNav() {
  return within(screen.getByRole("navigation", { name: "メインメニュー" }));
}

describe("AppShell のサイドバーグループ開閉", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
    window.localStorage.clear();
  });

  it("各グループが開閉ボタンになっており、既定では開いている", () => {
    renderShell();
    const toggle = mainNav().getByRole("button", { name: /アカウント・管理/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(mainNav().getByRole("link", { name: "AI設定" })).toBeInTheDocument();
  });

  it("グループ見出しを押すと閉じ、中の項目がアクセシビリティツリーから外れる", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(mainNav().getByRole("button", { name: /アカウント・管理/ }));

    expect(mainNav().getByRole("button", { name: /アカウント・管理/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(mainNav().queryByRole("link", { name: "AI設定" })).not.toBeInTheDocument();
  });

  it("閉じてもグループ見出し自体は見えたままで、件数が分かる", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(mainNav().getByRole("button", { name: /アカウント・管理/ }));

    expect(mainNav().getByRole("button", { name: /アカウント・管理/ })).toBeVisible();
  });

  it("閉じた状態を localStorage に保存し、次回訪問時も維持する", async () => {
    const user = userEvent.setup();
    const { unmount } = renderShell();

    await user.click(mainNav().getByRole("button", { name: /アカウント・管理/ }));
    unmount();

    renderShell();
    expect(mainNav().getByRole("button", { name: /アカウント・管理/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(mainNav().queryByRole("link", { name: "AI設定" })).not.toBeInTheDocument();
  });

  it("現在地を含むグループは保存された閉じ状態を無視して常に開く", () => {
    window.localStorage.setItem(
      "hiragaunsou:sidebar-collapsed-groups",
      JSON.stringify(["儲かっているかを見る", "アカウント・管理"]),
    );
    mockPathname = "/dashboard";
    renderShell();

    const analysis = mainNav().getByRole("button", { name: /儲かっているかを見る/ });
    expect(analysis).toHaveAttribute("aria-expanded", "true");
    // 見失わないよう畳めないようにする
    expect(analysis).toBeDisabled();
    expect(mainNav().getByRole("link", { name: /^ダッシュボード/ })).toBeInTheDocument();
    // 現在地を含まないグループは保存どおり閉じたまま
    expect(mainNav().getByRole("button", { name: /アカウント・管理/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("localStorage の値が壊れていても全グループを開いた状態にする", () => {
    window.localStorage.setItem("hiragaunsou:sidebar-collapsed-groups", "{壊れたJSON");
    renderShell();

    expect(mainNav().getByRole("button", { name: /アカウント・管理/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("各項目にホバーするとカスタムツールチップで説明(desc)が出る", async () => {
    const user = userEvent.setup();
    renderShell();

    const aiSettingsLink = mainNav().getByRole("link", { name: "AI設定" });
    expect(aiSettingsLink).not.toHaveAttribute("title");
    await user.hover(aiSettingsLink);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/AI/);
    await user.unhover(aiSettingsLink);

    const vehicleMasterLink = mainNav().getByRole("link", { name: "車両マスタ管理" });
    await user.hover(vehicleMasterLink);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/リース料/);
  });
});
