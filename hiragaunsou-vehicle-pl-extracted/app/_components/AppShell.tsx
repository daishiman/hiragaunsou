"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { visibleNavGroups, findNavItem, NAV_ITEMS, type NavBadge, type NavItem } from "../_lib/navigation";
import { withYm } from "../_lib/withYm";
import { useCurrentYm } from "./YmProvider";
import { signOut } from "../_lib/authClient";
import { useSidebarTooltip } from "./useSidebarTooltip";

/** 折りたたんだグループを覚えておくキー。開いた側ではなく閉じた側を保存する。 */
const COLLAPSED_GROUPS_KEY = "hiragaunsou:sidebar-collapsed-groups";

/**
 * 開閉状態は localStorage という「Reactの外の状態」なので useSyncExternalStore で読む。
 * useEffect で読み込んで setState する書き方だと初回描画のあとに必ず再描画が入るうえ、
 * サーバ描画との食い違いも自前で面倒を見る必要がある。
 * サーバ側スナップショットは空 = 全グループ開いた状態に倒す。
 */
const collapsedStoreListeners = new Set<() => void>();

function subscribeCollapsedGroups(onChange: () => void): () => void {
  collapsedStoreListeners.add(onChange);
  // 別タブで畳んだ結果もこのタブに反映する
  window.addEventListener("storage", onChange);
  return () => {
    collapsedStoreListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** 生の文字列を返す。参照が毎回変わると無限ループになるため、配列に変換せず値のまま返す。 */
function collapsedGroupsSnapshot(): string {
  try {
    return window.localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? "";
  } catch {
    return "";
  }
}

function collapsedGroupsServerSnapshot(): string {
  return "";
}

function parseCollapsedGroups(raw: string): readonly string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // 壊れた値は「全部開いている」に倒す
    return [];
  }
}

function writeCollapsedGroups(next: readonly string[]): void {
  try {
    window.localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても開閉自体は続けられるので握りつぶす
  }
  for (const listener of collapsedStoreListeners) listener();
}

export interface AppShellProps {
  userName: string;
  userRole: string;
  /** 権限マトリクスの参照キー。サイドバーで開けない画面を除くのに使う */
  role: string;
  /** ナビのバッジ件数 (0以下は非表示) */
  badges: Record<NavBadge, number>;
  children: React.ReactNode;
}

/**
 * 全画面共通のアプリシェル (サイドバー + トップバー + フッター)。
 * モック mock/index.html の .layout / .sidebar / .topbar 構成を Next.js に移植したもの。
 * SPではサイドバーをオフキャンバス化し、トップバーのボタンで開閉する。
 */
export function AppShell({ userName, userRole, role, badges, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const current = findNavItem(pathname);
  const navGroups = visibleNavGroups(role);
  // いま見ている対象月。サイドバーから別の画面へ移っても同じ月を見続けられるよう引き継ぐ。
  const ym = useCurrentYm();

  const collapsedRaw = useSyncExternalStore(
    subscribeCollapsedGroups,
    collapsedGroupsSnapshot,
    collapsedGroupsServerSnapshot,
  );
  const collapsedGroups = useMemo(() => parseCollapsedGroups(collapsedRaw), [collapsedRaw]);

  function toggleGroup(label: string) {
    writeCollapsedGroups(
      collapsedGroups.includes(label)
        ? collapsedGroups.filter((l) => l !== label)
        : [...collapsedGroups, label],
    );
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/sign-in");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  // SPのサイドバーはリンクを押した時点で閉じる。
  // pathname を見る useEffect で閉じると「描画後に state を書き換える」ことになり、
  // 余計な再レンダリングが1回入る。閉じるのは遷移の副作用ではなく操作そのものなので、
  // クリックハンドラで閉じるのが素直。
  const closeNav = () => setNavOpen(false);

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

        {/*
          ホームは「最初に見るべき場所」として、他のメニュー項目と同じ並びに埋もれさせない。
          常時 brand-soft の面を敷いて視覚的に切り離し、迷ったらまずここ、を伝える。
        */}
        <SidebarHomeLink
          active={pathname === "/"}
          closeNav={closeNav}
          desc={NAV_ITEMS.find((i) => i.href === "/")?.desc ?? ""}
        />

        <nav className="flex-1 px-2 py-1" aria-label="メインメニュー">
          {navGroups.map((group) => {
            const items = group.items.filter((item) => item.href !== "/");
            // 現在地を含むグループは畳ませない。開閉のせいで自分の居場所を見失わせないため。
            const hasCurrent = items.some((item) => item.href === current?.href);
            const open = hasCurrent || !collapsedGroups.includes(group.label);
            const panelId = `nav-group-${encodeURIComponent(group.label)}`;
            return (
              <div key={group.label} className="border-t border-line py-2 first:border-t-0">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={open}
                  aria-controls={panelId}
                  disabled={hasCurrent}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold tracking-wide text-ink-muted hover:bg-subtle disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    aria-hidden="true"
                    className={[
                      "shrink-0 transition-transform duration-150",
                      open ? "rotate-90" : "",
                    ].join(" ")}
                  >
                    <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  {!open && (
                    <span className="num shrink-0 rounded bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
                      {items.length}
                    </span>
                  )}
                </button>
                <ul id={panelId} hidden={!open}>
                {items.map((item) => {
                  const active = current?.href === item.href;
                  const count = item.badge ? badges[item.badge] : 0;
                  return (
                    <SidebarNavLink
                      key={item.href}
                      item={item}
                      href={withYm(item.href, ym)}
                      active={active}
                      count={count}
                      closeNav={closeNav}
                    />
                  );
                })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-line px-4 py-3">
          <Link href="/profile" onClick={closeNav} className="block hover:underline">
            <p className="truncate text-xs font-semibold text-ink">{userName}</p>
            <p className="mt-0.5 text-[11px] text-ink-muted">{userRole}</p>
          </Link>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="pressable mt-2 w-full rounded-md border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-muted hover:bg-subtle disabled:opacity-50"
          >
            {signingOut ? "ログアウトしています…" : "ログアウト"}
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        {/*
          高さを固定する。下に貼り付ける工程タブ (StickyStepHeader) が
          この高さを基準に位置を決めるため、中身によって伸び縮みすると重なる。
        */}
        <header className="sticky top-0 z-30 flex h-[var(--app-header-h)] items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:px-6">
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
              <Link href={withYm("/import", ym)} className="hover:text-brand-deep hover:underline">
                月次データ取込
              </Link>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}

interface SidebarHomeLinkProps {
  active: boolean;
  closeNav: () => void;
  desc: string;
}

/** ホームリンク単体。ホバー説明は自前ツールチップで毎回確実に出す (rules of hooks のため独立コンポーネント化)。 */
function SidebarHomeLink({ active, closeNav, desc }: SidebarHomeLinkProps) {
  const { triggerRef, handlers, tooltip } = useSidebarTooltip<HTMLAnchorElement>(desc);

  return (
    <div className="border-b border-line px-2 pb-3 pt-3">
      <Link
        ref={triggerRef}
        href="/"
        onClick={closeNav}
        aria-current={active ? "page" : undefined}
        {...handlers}
        className={[
          "flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors",
          active ? "bg-brand text-white" : "bg-brand-soft text-brand-deep hover:bg-brand-soft/70",
        ].join(" ")}
      >
        <span>ホーム</span>
        <span
          className={[
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            active ? "bg-white/20 text-white" : "bg-white text-brand-deep",
          ].join(" ")}
        >
          まずはここ
        </span>
      </Link>
      {tooltip}
    </div>
  );
}

interface SidebarNavLinkProps {
  item: NavItem;
  href: string;
  active: boolean;
  count: number;
  closeNav: () => void;
}

/** グループ内メニュー項目1件。ホバー説明は自前ツールチップで毎回確実に出す (rules of hooks のため独立コンポーネント化)。 */
function SidebarNavLink({ item, href, active, count, closeNav }: SidebarNavLinkProps) {
  const { triggerRef, handlers, tooltip } = useSidebarTooltip<HTMLAnchorElement>(item.desc);

  return (
    <li>
      <Link
        ref={triggerRef}
        href={href}
        onClick={closeNav}
        aria-current={active ? "page" : undefined}
        {...handlers}
        className={[
          "flex items-center gap-2 rounded-md px-2 py-2 text-[13px]",
          active ? "bg-brand-soft font-semibold text-brand-deep" : "text-ink hover:bg-subtle",
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
      {tooltip}
    </li>
  );
}
