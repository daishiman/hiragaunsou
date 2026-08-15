"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  visibleNavGroups,
  visibleAccountGroups,
  findNavItem,
  NAV_ITEMS,
  type NavBadge,
  type NavItem,
} from "../_lib/navigation";
import { withYm } from "../_lib/withYm";
import { useCurrentYm } from "./YmProvider";
import { signOut } from "../_lib/authClient";
import { useHoverTooltip } from "./useHoverTooltip";
import { IconButton } from "./IconButton";
import { SidebarAccountMenu } from "./SidebarAccountMenu";
import { FeedbackWidget } from "./FeedbackWidget";
import { DiagnosticsRecorder } from "./DiagnosticsRecorder";

/**
 * サイドバーを隠しているかどうかを覚えておくキー。
 * 既定 (キーが無い) は「表示」。初めて開いた人が何も設定しなくても正しい状態になるようにする。
 */
const SIDEBAR_HIDDEN_KEY = "hiragaunsou:sidebar-hidden";

/**
 * 表示/非表示は localStorage という「Reactの外の状態」なので useSyncExternalStore で読む。
 * useEffect で読み込んで setState する書き方だと初回描画のあとに必ず再描画が入るうえ、
 * サーバ描画との食い違いも自前で面倒を見る必要がある。
 * サーバ側スナップショットは「表示」に倒す。
 */
const hiddenStoreListeners = new Set<() => void>();

function subscribeSidebarHidden(onChange: () => void): () => void {
  hiddenStoreListeners.add(onChange);
  // 別タブで隠した結果もこのタブに反映する
  window.addEventListener("storage", onChange);
  return () => {
    hiddenStoreListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function sidebarHiddenSnapshot(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function sidebarHiddenServerSnapshot(): boolean {
  return false;
}

function writeSidebarHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(SIDEBAR_HIDDEN_KEY, "1");
    else window.localStorage.removeItem(SIDEBAR_HIDDEN_KEY);
  } catch {
    // 保存できなくても開閉自体は続けられるので握りつぶす
  }
  for (const listener of hiddenStoreListeners) listener();
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
 *
 * サイドバーの方針 (2026-08-09 の決定。判断基準は docs/design-system-components.md §11-9):
 *   - 常時出すのは業務の画面だけ。運用・設定・仕様書はユーザー名のメニューへ畳む。
 *   - グループは折りたたまない。どの画面へも常に1クリックで着く。
 *     「画面に集中したい」にはサイドバーごと隠すトグルで応える。
 *   - 常時出すバッジは「未判定の件数」だけ。見ても次の行動が変わらない数字は出さない。
 *
 * SPではサイドバーをオフキャンバス化し、トップバーのボタンで開閉する。
 */
export function AppShell({ userName, userRole, role, badges, children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const current = findNavItem(pathname);
  const navGroups = visibleNavGroups(role);
  const accountGroups = visibleAccountGroups(role);
  // いま見ている対象月。サイドバーから別の画面へ移っても同じ月を見続けられるよう引き継ぐ。
  const ym = useCurrentYm();

  const sidebarHidden = useSyncExternalStore(
    subscribeSidebarHidden,
    sidebarHiddenSnapshot,
    sidebarHiddenServerSnapshot,
  );

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
    <div className={sidebarHidden ? "min-h-screen" : "min-h-screen lg:grid lg:grid-cols-[14rem_1fr]"}>
      {/* SP: オフキャンバス時の背景。クリックで閉じる */}
      {navOpen && (
        <button
          type="button"
          aria-label="メニューを閉じる（背景）"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-ink/30 lg:hidden"
        />
      )}

      <aside
        id="app-sidebar"
        className={[
          // app-sidebar は改善要望のスクリーンショットで「貼り付いて見えている位置」を
          // 再現するための目印も兼ねる (FeedbackWidget が参照する)。
          "app-sidebar fixed inset-y-0 left-0 z-50 flex w-56 flex-col overflow-y-auto border-r border-line bg-white",
          "transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          navOpen ? "translate-x-0" : "-translate-x-full",
          // PCで隠しているときだけ消す。SPのオフキャンバスは今までどおり動く。
          sidebarHidden ? "lg:hidden" : "",
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
          常時 brand-soft の面を敷いて視覚的に切り離す。位置と面だけで十分伝わるので、
          かつて添えていた「まずはここ」バッジは外した。
        */}
        <SidebarHomeLink
          active={pathname === "/"}
          closeNav={closeNav}
          desc={NAV_ITEMS.find((i) => i.href === "/")?.desc ?? ""}
        />

        <nav className="flex-1 px-2 py-1" aria-label="メインメニュー">
          {navGroups.map((group) => {
            const items = group.items.filter((item) => item.href !== "/");
            if (items.length === 0) return null;
            const headingId = `nav-group-${encodeURIComponent(group.label)}`;
            return (
              <div key={group.label} className="border-t border-line py-2 first:border-t-0">
                {/*
                  グループ見出しは押せない只のラベル。折りたたみは廃止した
                  (畳めば中の画面が2クリックになり、毎月の締めで何度も往復する画面が遠くなる)。
                */}
                <p
                  id={headingId}
                  className="px-2 py-1.5 text-[11px] font-semibold tracking-wide text-ink-muted"
                >
                  {group.label}
                </p>
                <ul aria-labelledby={headingId}>
                  {items.map((item) => (
                    <SidebarNavLink
                      key={item.href}
                      item={item}
                      href={withYm(item.href, ym)}
                      active={current?.href === item.href}
                      count={item.badge ? badges[item.badge] : 0}
                      closeNav={closeNav}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <SidebarAccountMenu
          userName={userName}
          userRole={userRole}
          groups={accountGroups}
          currentHref={current?.href ?? null}
          signingOut={signingOut}
          onSignOut={() => void handleSignOut()}
          onNavigate={closeNav}
        />
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        {/*
          高さを固定する。下に貼り付ける工程タブ (StickyStepHeader) が
          この高さを基準に位置を決めるため、中身によって伸び縮みすると重なる。
        */}
        <header className="app-header sticky top-0 z-30 flex h-[var(--app-header-h)] items-center gap-2 border-b border-line bg-white/95 px-4 backdrop-blur lg:px-6">
          {/*
            サイドバーの開閉。幅によって「開閉するもの」が違うので2つ用意するが、
            画面に出るのは常にどちらか1つだけ。どちらも同じ位置の同じ大きさのアイコンで、
            名前(aria-label)は必ず「何が起きるか」を動詞で書く。

            かつてここには「メニュー」という文字ボタンがあった。名詞なので押すと何が
            起きるか分からず、しかも細い画面でしか出ないため「押しても何も出ない」と
            受け取られていた。名前を動作にして、見た目はアイコンに統一した。
          */}
          <span className="lg:hidden">
            <IconButton
              name={navOpen ? "close" : "menu"}
              label={navOpen ? "メニューを閉じる" : "メニューを開く"}
              onClick={() => setNavOpen((v) => !v)}
              aria-expanded={navOpen}
              aria-controls="app-sidebar"
            />
          </span>
          {/*
            PC用の表示/非表示トグル。隠した状態でも必ずここに出ているので、
            戻し方が分からなくなることがない (1操作で元に戻せる)。
          */}
          <span className="hidden lg:inline-flex">
            <IconButton
              name={sidebarHidden ? "panel-left-open" : "panel-left-close"}
              label={sidebarHidden ? "メニューを表示" : "メニューを隠す"}
              onClick={() => writeSidebarHidden(!sidebarHidden)}
              aria-expanded={!sidebarHidden}
              aria-controls="app-sidebar"
            />
          </span>
          <p className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
            {current?.label ?? "車両収支管理システム"}
          </p>
        </header>

        {/*
          本文はどの画面でも幅いっぱい。画面ごとに幅を変えない。

          一度「読むだけの画面は狭くする」を入れたが、依頼者から不具合として指摘された。
          カード・フォーム・見出しは横に伸びても読みにくくならないのに、ページごと
          止めると広い画面で右半分が丸ごと空き、表示が壊れて見える。
          読み幅を制限してよいのは「途切れない長文の段落」だけで、それは
          globals.css の .prose-note が段落ブロック単位で持つ。ページ全体には掛けない。
          詳細は docs/design-system-components.md §11-11。
        */}
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>

        {/*
          フッターはアプリ名だけにした。かつて置いていた3本のリンクは
          サイドバーとアカウントメニューに同じものがあり、重複しているだけだった。
        */}
        <footer className="border-t border-line bg-white px-4 py-5 text-xs text-ink-muted lg:px-8">
          <p>車両収支管理システム — 平賀運送</p>
        </footer>
      </div>

      {/*
        改善要望はここ1箇所だけに置く。画面ごとに置くと、置き忘れた画面が
        「意見を出せない画面」になる (どの画面からでも同じ場所に出るのが大事)。
      */}
      <FeedbackWidget />

      {/*
        画面の裏で控えを始める。要望が届いてから「そのときエラーは出ていましたか」と
        聞き直さずに済むよう、開いた瞬間から控える。
      */}
      <DiagnosticsRecorder />
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
  const { triggerRef, handlers, tooltip } = useHoverTooltip<HTMLAnchorElement>(desc);

  return (
    <div className="border-b border-line px-2 pb-3 pt-3">
      <Link
        ref={triggerRef}
        href="/"
        onClick={closeNav}
        aria-current={active ? "page" : undefined}
        {...handlers}
        className={[
          "block rounded-lg px-3 py-2.5 text-sm font-bold transition-colors",
          active ? "bg-brand text-white" : "bg-brand-soft text-brand-deep hover:bg-brand-soft/70",
        ].join(" ")}
      >
        ホーム
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
  const { triggerRef, handlers, tooltip } = useHoverTooltip<HTMLAnchorElement>(item.desc);

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
          <span className="num shrink-0 rounded-full bg-danger px-1.5 py-0.5 text-[11px] font-bold text-white">
            {count}
          </span>
        )}
      </Link>
      {tooltip}
    </li>
  );
}
