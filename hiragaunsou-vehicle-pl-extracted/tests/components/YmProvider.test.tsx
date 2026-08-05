/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

let mockSearch = "ym=2026-05";

vi.mock("next/navigation", () => ({
  usePathname: () => "/cleansing",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

vi.mock("../../app/_lib/authClient", () => ({ signOut: vi.fn(async () => {}) }));

import { AppShell } from "../../app/_components/AppShell";
import { YmProvider } from "../../app/_components/YmProvider";

function renderShell() {
  return render(
    <YmProvider>
      <AppShell userName="今西さん" userRole="管理者" role="admin" badges={{ registration: 0, anomaly: 0 }}>
        <p>本文</p>
      </AppShell>
    </YmProvider>,
  );
}

function mainNav() {
  return within(screen.getByRole("navigation", { name: "メインメニュー" }));
}

describe("YmProvider + AppShell", () => {
  beforeEach(() => {
    mockSearch = "ym=2026-05";
  });

  it("URLのymをサイドバーの各リンクへ引き継ぐ(別画面へ移っても同じ月を見続けられる)", () => {
    renderShell();
    expect(mainNav().getByRole("link", { name: /^データ取込/ })).toHaveAttribute(
      "href",
      "/import?ym=2026-05",
    );
    expect(mainNav().getByRole("link", { name: /^月次収支表/ })).toHaveAttribute(
      "href",
      "/grid?ym=2026-05",
    );
  });

  it("対象月を持たない画面へのリンクにはymを付けない", () => {
    renderShell();
    expect(mainNav().getByRole("link", { name: "ダッシュボード" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(mainNav().getByRole("link", { name: "車両マスタ管理" })).toHaveAttribute(
      "href",
      "/admin/vehicle-master",
    );
  });

  it("URLにymが無ければリンクは従来どおり(各画面の既定月にフォールバックする)", () => {
    mockSearch = "";
    renderShell();
    expect(mainNav().getByRole("link", { name: /^データ取込/ })).toHaveAttribute("href", "/import");
  });
});
