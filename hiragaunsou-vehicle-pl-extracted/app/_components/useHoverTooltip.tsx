"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SHOW_DELAY_MS = 150;

/** ツールチップを出す向き。right=サイドバーの項目、bottom=上部バーのアイコンボタン。 */
export type TooltipPlacement = "right" | "bottom";

/**
 * ホバー/フォーカスで出す説明。
 *
 * ネイティブのtitle属性はブラウザ側のクールダウンにより、ツールチップを閉じた直後の
 * 再ホバーでは表示されないことがある(Chrome系で顕著)。またキーボードで辿ったときは
 * そもそも出ない。hover状態とfocus状態を自前で持ち、position:fixedのポータルで
 * どちらでも必ず表示する。
 *
 * サイドバー(aside)はoverflow-y-autoかつtransformを持つため、position:fixedでも
 * asideの内側に閉じ込められてクリップされる。document.bodyへポータルしてこれを回避する。
 *
 * 返す tooltipId は、アイコンだけのボタンに aria-describedby で結びつけるためのもの。
 * 名前(aria-label)は別に付ける。ツールチップは「名前」ではなく「説明」として扱う。
 */
export function useHoverTooltip<T extends HTMLElement>(
  label: string,
  placement: TooltipPlacement = "right",
) {
  const triggerRef = useRef<T>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos(
        placement === "bottom"
          ? { top: rect.bottom + 8, left: rect.left + rect.width / 2 }
          : { top: rect.top + rect.height / 2, left: rect.right + 8 },
      );
    }, SHOW_DELAY_MS);
  }, [placement]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPos(null);
  }, []);

  useEffect(() => () => hide(), [hide]);

  const tooltip =
    pos &&
    createPortal(
      <span
        id={tooltipId}
        role="tooltip"
        style={{ top: pos.top, left: pos.left }}
        className={[
          "pointer-events-none fixed z-[60] max-w-64 rounded-md bg-ink px-2.5 py-1.5",
          "text-xs font-medium leading-snug text-white shadow-lg",
          placement === "bottom" ? "-translate-x-1/2" : "-translate-y-1/2",
        ].join(" ")}
      >
        {label}
      </span>,
      document.body,
    );

  return {
    triggerRef,
    tooltipId,
    handlers: { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide },
    tooltip,
  };
}
