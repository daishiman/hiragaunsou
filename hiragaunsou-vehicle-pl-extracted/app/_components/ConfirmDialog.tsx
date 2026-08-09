"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * 消す・元に戻せない操作の前に挟む確認。
 *
 * ブラウザ標準の confirm() を置き換える。標準のものは
 * 「アプリの文章なのかブラウザの警告なのか」が見た目で区別できず、何を消すのかを
 * 太字や一覧で示すこともできない(取り消せない操作ほど、対象を目で確かめられる必要がある)。
 *
 * 既定の焦点は「やめる」に置く。Enter を押しっぱなしにしていた人が、
 * 開いた瞬間に削除を確定してしまう事故を防ぐ (ux-design 摩擦の非対称性)。
 */
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  cancelLabel = "やめる",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** danger = 消す操作。caution = 消さないが元に戻すのに手間が要る操作 */
  tone?: "danger" | "caution";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** 何が起きるかの説明。対象の一覧を並べてもよい */
  children?: ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/30" aria-hidden onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-xl border border-line bg-white p-5 shadow-xl"
      >
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        {children ? (
          <div className="mt-2 text-xs leading-relaxed text-ink-muted">{children}</div>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="btn btn-quiet pressable"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`pressable rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              tone === "danger" ? "bg-danger" : "bg-accent hover:bg-accent-deep"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
