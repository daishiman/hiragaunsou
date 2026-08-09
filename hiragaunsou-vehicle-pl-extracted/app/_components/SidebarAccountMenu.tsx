"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NavGroup } from "../_lib/navigation";

/**
 * サイドバー下部のユーザー名から開くアカウントメニュー。
 *
 * 月に1回も開かない画面 (マイページ・ユーザー管理・AI設定・利用状況・取込データ管理・
 * データ設計の説明) と、ログアウトをここに集約する。常時サイドバーに並べても
 * 「これが無いと何が分からなくなるか」に答えられないため、必要なときだけ開く場所へ移した。
 *
 * 位置は body へのポータル + fixed で決める。サイドバー (aside) は overflow-y-auto を
 * 持つので、内側に絶対配置すると上方向へ開いたメニューが切り取られる
 * (useSidebarTooltip.tsx と同じ理由・同じ回避)。
 */

export interface SidebarAccountMenuProps {
  userName: string;
  userRole: string;
  groups: NavGroup[];
  /** いま開いている画面。メニュー内の項目なら現在地として印を付ける */
  currentHref: string | null;
  signingOut: boolean;
  onSignOut: () => void;
  /** SPではメニューから移動した時点でサイドバー自体を閉じる */
  onNavigate: () => void;
}

export function SidebarAccountMenu({
  userName,
  userRole,
  groups,
  currentHref,
  signingOut,
  onSignOut,
  onNavigate,
}: SidebarAccountMenuProps) {
  const menuId = useId();
  const triggerId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ bottom: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** 開いた直後にフォーカスを当てる位置。null = 当てない (マウスで開いたとき) */
  const pendingFocus = useRef<"first" | "last" | null>(null);

  const items = groups.flatMap((g) => g.items);
  /** メニュー内に現在地があるか。あればサイドバーのどこにも印が出ない状態を避ける */
  const currentItem = items.find((i) => i.href === currentHref) ?? null;

  const measure = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      bottom: window.innerHeight - rect.top + 8,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    pendingFocus.current = null;
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  function openWith(focus: "first" | "last" | null) {
    pendingFocus.current = focus;
    measure();
    setOpen(true);
  }

  // 開いた直後の位置合わせとフォーカス移動。描画後・ペイント前に済ませて
  // メニューが一瞬ずれた位置に出るのを防ぐ。
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const focusables = menuItemNodes(menuRef.current);
    if (pendingFocus.current === "first") focusables[0]?.focus();
    if (pendingFocus.current === "last") focusables[focusables.length - 1]?.focus();
    pendingFocus.current = null;
  }, [open, measure]);

  // 外側クリックで閉じる。スクロール・リサイズでは位置だけ追従させる
  // (閉じてしまうと、開き直す手間が増えるだけで得るものが無い)。
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, close, measure]);

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openWith("first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openWith("last");
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close(true);
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const nodes = menuItemNodes(menuRef.current);
    if (nodes.length === 0) return;
    const index = nodes.indexOf(document.activeElement as HTMLElement);

    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      nodes[(index + 1) % nodes.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nodes[(index - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      nodes[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (e.key === "Tab") {
      // メニューの外へ出るときは開きっぱなしにしない
      close(false);
    }
  }

  const menu = open && (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-labelledby={triggerId}
      onKeyDown={onMenuKeyDown}
      style={pos ? { bottom: pos.bottom, left: pos.left, width: Math.max(pos.width, 208) } : undefined}
      className="fixed z-[70] rounded-lg border border-line bg-white p-1.5 shadow-lg"
    >
      {groups.map((group, gi) => (
        <div
          key={group.label}
          role="group"
          aria-label={group.label}
          className={gi > 0 ? "mt-1 border-t border-line pt-1" : ""}
        >
          <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold tracking-wide text-ink-muted">
            {group.label}
          </p>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              aria-current={item.href === currentHref ? "page" : undefined}
              onClick={() => {
                close(false);
                onNavigate();
              }}
              className={[
                "block rounded-md px-2 py-1.5 text-[13px]",
                item.href === currentHref
                  ? "bg-brand-soft font-semibold text-brand-deep"
                  : "text-ink hover:bg-subtle",
              ].join(" ")}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
      <div className="mt-1 border-t border-line pt-1">
        <button
          type="button"
          role="menuitem"
          disabled={signingOut}
          onClick={() => {
            close(false);
            onSignOut();
          }}
          className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] text-ink hover:bg-subtle disabled:opacity-60"
        >
          {signingOut ? "ログアウトしています…" : "ログアウト"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="border-t border-line px-2 py-2">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openWith(null))}
        onKeyDown={onTriggerKeyDown}
        className={[
          "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
          currentItem ? "bg-brand-soft text-brand-deep" : "text-ink hover:bg-subtle",
        ].join(" ")}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">{userName}</span>
          {/*
            現在地がメニューの中にあるときは、ロールではなく開いている画面名を出す。
            畳んだ先にいても「いまどこにいるか」がサイドバー上で分かるようにするため。
          */}
          <span className="mt-0.5 block truncate text-[11px] text-ink-muted">
            {currentItem ? currentItem.label : userRole}
          </span>
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0">
          <path
            d={open ? "M1.5 6.5 L5 3 L8.5 6.5" : "M1.5 3.5 L5 7 L8.5 3.5"}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {menu && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
    </div>
  );
}

/** メニュー内の押せる項目 (リンクとログアウト) を順番どおりに集める。 */
function menuItemNodes(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
}
