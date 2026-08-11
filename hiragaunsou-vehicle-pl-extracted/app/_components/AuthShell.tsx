import type { ReactNode } from "react";

/**
 * ログインなど、アプリの枠 (AppShell) の外にある画面の枠組み。
 *
 * ログイン画面と「見つかりませんでした」画面は、それぞれが自前で
 * 「中央寄せの箱」を書いていた。結果として同じアプリなのにフッターが無く、
 * 「ここは本当にこのアプリか」の手がかりが名前だけになっていた。
 *
 * アプリ内の全画面が下に出しているフッターと同じものをここでも出す。
 * 枠組みが同じであることが、そのまま「同じアプリだ」という合図になる。
 */
export function AuthShell({
  /** 画面の中身。カード1枚を想定している */
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-5 py-10">
        {children}
      </main>
      <footer className="border-t border-line bg-white px-4 py-5 text-center text-xs text-ink-muted">
        <p>車両収支管理システム — 平賀運送</p>
      </footer>
    </div>
  );
}
