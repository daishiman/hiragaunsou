import type { ReactNode } from "react";

/**
 * マスタ系画面(車両マスタ管理・運転者マスタ管理・率マスタ設定)の「この画面の数字はどこから来るか」欄。
 *
 * 3画面で書き方がばらばらだと、同じ社内Excelを指しているのか別物なのかが読む人に判断できない。
 * 出所の説明(children)は画面ごとに違うが、器と末尾の断り書きは必ず共通にする。
 *
 * 末尾の断り書きは、ファイル名が変わっただけで「もう使えない」と諦められないようにするためのもの。
 * 社内Excelは年度や担当者が変わると名前が変わるが、このシステムはファイル名ではなく
 * 中身(シートの見出しと列名)で読んでいるので、名前が変わっても取り込める。
 */
export function SourceDataNote({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-sm font-bold text-ink">この画面の数字の出どころ</h2>
      <div className="mt-1 space-y-2 text-xs leading-relaxed text-ink-muted">
        {children}
        <p>
          社内Excelのファイル名は今後変わることがあります。名前が変わっても、
          中身(シートの見出しと列の並び)が同じであればそのまま読み取れます。
          読み取れない・数字が合わないときは、画面をそのままスクリーンショットでご連絡ください。
        </p>
      </div>
    </section>
  );
}
