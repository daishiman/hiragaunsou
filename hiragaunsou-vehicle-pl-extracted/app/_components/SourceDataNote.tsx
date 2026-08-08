import type { ReactNode } from "react";

/**
 * マスタ系画面(車両マスタ管理・運転者マスタ管理・率マスタ設定)の「この画面の数字はどこから来るか」欄。
 *
 * 3画面で書き方がばらばらだと、同じ社内Excelを指しているのか別物なのかが読む人に判断できない。
 * 出所の説明(children)は画面ごとに違うが、器・元ファイル名の見せ方・末尾の断り書きは必ず共通にする。
 *
 * 末尾の断り書きは、ファイル名が変わっただけで「もう使えない」と諦められないようにするためのもの。
 * 社内のファイル名は月ごと・年度ごとに変わる(実データの「5給与集計表(日給者).csv」の先頭の5は月)。
 * このシステムはファイル名ではなく列の見出しで中身を判定するので、別名でも取り込める
 * (判定に使う列は docs/product/data-flow-map.md §6)。
 */
export function SourceDataNote({
  sourceFile,
  children,
}: {
  /** 確認済みの実ファイル名。手入力のみの画面では省略する。 */
  sourceFile?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-sm font-bold text-ink">この画面の数字の出どころ</h2>
      <div className="mt-1 space-y-2 text-xs leading-relaxed text-ink-muted">
        {sourceFile ? (
          <p>
            元のファイル: <span className="font-bold text-ink">{sourceFile}</span>
          </p>
        ) : null}
        {children}
        <p>
          社内のファイル名は毎月・将来ともに変わることがあります。名前が変わっても、
          中身の列(見出しの文字)が同じであれば別名のファイルでもそのまま取り込めます。
          このシステムはファイル名ではなく列の見出しで中身を見分けています。
          読み取れない・数字が合わないときは、画面をそのままスクリーンショットでご連絡ください。
        </p>
      </div>
    </section>
  );
}
