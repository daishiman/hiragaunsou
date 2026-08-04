"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_GROUPS, findNavItem, type NavBadge } from "../_lib/navigation";
import { yearMonthLabel } from "../_lib/format";

export interface AppShellProps {
  userName: string;
  userRole: string;
  yearMonth: string;
  /** ナビのバッジ件数 (0以下は非表示) */
  badges: Record<NavBadge, number>;
  children: React.ReactNode;
}

/**
 * 全画面共通のアプリシェル (サイドバー + トップバー + フッター)。
 * モック mock/index.html の .layout / .sidebar / .topbar 構成を Next.js に移植したもの。
 * SPではサイドバーをオフキャンバス化し、トップバーのボタンで開閉する。
 */
export function AppShell({ userName, userRole, yearMonth, badges, children }: AppShellProps) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const current = findNavItem(pathname);

  // 画面遷移したらSPのサイドバーは閉じる (開きっぱなしで内容が隠れるのを防ぐ)
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[14rem_1fr]">
      {/* SP: オフキャンバス時の背景。クリックで閉じる */}
      {navOpen && (
        <button
          type="button"
          aria-label="メニューを閉じる"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-ink/30 lg:hidden"
        />
      )}

      <aside
        id="app-sidebar"
        className={[
          "fixed inset-y-0 left-0 z-50 flex w-56 flex-col overflow-y-auto border-r border-line bg-white",
          "transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          navOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="border-b border-line px-4 py-4">
          <Link href="/" className="block">
            <p className="text-sm font-bold text-ink">車両収支管理システム</p>
            <p className="mt-0.5 text-xs text-ink-muted">平賀運送</p>
          </Link>
        </div>

        <nav className="flex-1 px-2 py-3" aria-label="メインメニュー">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-2 pb-1.5 text-[11px] font-semibold tracking-wide text-ink-muted">
                {group.label}
              </p>
              <ul>
                {group.items.map((item) => {
                  const active = current?.href === item.href;
                  const count = item.badge ? badges[item.badge] : 0;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={[
                          "flex items-center gap-2 rounded-md px-2 py-2 text-[13px]",
                          active
                            ? "bg-brand-soft font-semibold text-brand-deep"
                            : "text-ink hover:bg-subtle",
                        ].join(" ")}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {count > 0 && (
                          <span
                            className={[
                              "num shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-bold text-white",
                              item.badge === "anomaly" ? "bg-danger" : "bg-accent",
                            ].join(" ")}
                          >
                            {count}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line px-4 py-3">
          <p className="truncate text-xs font-semibold text-ink">{userName}</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">{userRole}</p>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white/95 px-4 py-3 backdrop-blur lg:px-6">
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
            className="pressable rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold text-ink lg:hidden"
          >
            メニュー
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
            {current?.label ?? "車両収支管理システム"}
          </p>
          <p className="num shrink-0 text-xs text-ink-muted">{yearMonthLabel(yearMonth)}度</p>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>

        <footer className="border-t border-line bg-white px-4 py-5 text-xs text-ink-muted lg:px-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>車両収支管理システム — 平賀運送</p>
            <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="フッターメニュー">
              <Link href="/logic" className="hover:text-brand-deep hover:underline">
                データ設計・自動化方針
              </Link>
              <Link href="/usage" className="hover:text-brand-deep hover:underline">
                利用状況
              </Link>
              <Link href="/import" className="hover:text-brand-deep hover:underline">
                月次データ取込
              </Link>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
