"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY_MS = 150;

/**
 * サイドバー項目のホバー説明。
 *
 * ネイティブのtitle属性はブラウザ側のクールダウンにより、ツールチップを閉じた直後の
 * 再ホバーでは表示されないことがある(Chrome系で顕著)。hover/focus状態を自前で持ち、
 * position:fixedのポータルで毎回確実に表示する。
 * サイドバー(aside)はoverflow-y-autoかつtransformを持つため、position:fixedでも
 * asideの内側に閉じ込められてクリップされる。document.bodyへポータルすることでこれを回避する。
 */
export function useSidebarTooltip<T extends HTMLElement>(label: string) {
  const triggerRef = useRef<T>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos({ top: rect.top + rect.height / 2, left: rect.right + 8 });
    }, SHOW_DELAY_MS);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPos(null);
  }, []);

  useEffect(() => () => hide(), [hide]);

  const tooltip =
    pos &&
    createPortal(
      <span
        role="tooltip"
        style={{ top: pos.top, left: pos.left }}
        className="pointer-events-none fixed z-[60] max-w-64 -translate-y-1/2 rounded-md bg-ink px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-lg"
      >
        {label}
      </span>,
      document.body,
    );

  return {
    triggerRef,
    handlers: { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide },
    tooltip,
  };
}
