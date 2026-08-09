"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * 画面の右から出る引き出し。長い説明文の退避先。
 *
 * この仕組みが無かったため、読まなくても作業できる説明が全部そのまま画面に置かれ、
 * マスタ系の3画面は初期表示が1,000字を超えていた。文章は減らさず、出す場所だけを
 * 「押したあと」に移すのがこの部品の役目。
 *
 * 閉じる手段を3つ用意する(Escキー・背景クリック・閉じるボタン)。
 * 説明を読むだけの引き出しなので、閉じ方が分からず詰まることが一番の失敗になる。
 */
export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // 開いた直後に閉じるボタンへ移す。キーボードだけで開いた人が、
    // 背景の要素を延々とタブで辿らずに読み始められるようにする。
    closeButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 背景。押せば閉じるが、読み上げには出さない(閉じるボタンが正規の手段) */}
      <div className="absolute inset-0 bg-ink/30" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-sm font-bold text-ink">{title}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="btn btn-quiet btn-sm pressable shrink-0"
          >
            閉じる
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-xs leading-relaxed text-ink-muted">
          {children}
        </div>
      </div>
    </div>
  );
}
