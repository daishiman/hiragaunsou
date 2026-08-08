"use client";

import { useState, type ReactNode } from "react";
import { Drawer } from "./Drawer";

/**
 * 見出しの横に置く「?」ボタンと、その中身を出す引き出しの組。
 *
 * 「読まなくても作業できるが、読めば分かる」説明はすべてこの中に入れる。
 * 初期表示には ? の1文字しか出ないので、画面を開いた人はまず操作に集中でき、
 * 分からなくなったときだけ1クリックで全文に辿り着ける。
 *
 * サーバコンポーネントから children をそのまま渡せる形にしてある
 * (説明文の中の Link もそのまま使える)。
 */
export function HelpDrawer({
  title,
  label = "この画面について",
  children,
}: {
  /** 引き出しの見出し */
  title: string;
  /** ボタンの読み上げ名。画面には「?」しか出さない */
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className="pressable inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-white text-xs font-bold text-ink-muted hover:border-brand hover:bg-brand-soft hover:text-brand-deep"
      >
        ?
      </button>
      <Drawer open={open} title={title} onClose={() => setOpen(false)}>
        {children}
      </Drawer>
    </>
  );
}
