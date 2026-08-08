import type { ReactNode } from "react";

/**
 * マスタ系画面(車両マスタ管理・運転者マスタ管理・率マスタ設定)の「この画面の数字はどこから来るか」欄。
 *
 * 3画面で書き方がばらばらだと、同じ社内Excelを指しているのか別物なのかが読む人に判断できない。
 * 出所の説明(children)は画面ごとに違うが、器・元ファイル名の見せ方・末尾の断り書きは必ず共通にする。
 *
 * 末尾の断り書きは、ファイル名が変わっただけで「もう使えない」と諦められないようにするためのもの。
 * 社内のファイル名は月ごと・年度ごとに変わり、年月が入っていないこともある
 * (実データの「車両別運行実績表(燃費計算)本社.csv」には年月が無い)。
 * このシステムは種別も年月もファイル名を見ず、中身だけで判定する
 * (判定に使う列は docs/product/data-flow-map.md §6)。
 * そのため画面に書くファイル名は「目印としての例」であり、この名前でなければ取り込めない、
 * という意味には読めない書き方にする。
 */
export function SourceDataNote({
  sourceFile,
  children,
}: {
  /** 確認済みの実ファイル名の一例。手入力のみの画面では省略する。 */
  sourceFile?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-sm font-bold text-ink">この画面の数字の出どころ</h2>
      <div className="mt-1 space-y-2 text-xs leading-relaxed text-ink-muted">
        {sourceFile ? (
          <p>
            元のファイル(名前の例): <span className="font-bold text-ink">{sourceFile}</span>
          </p>
        ) : null}
        {children}
        <p>
          <span className="font-bold text-ink">ファイル名は変わっても構いません。中身で判定します。</span>
          社内のファイル名は毎月・将来ともに変わり、年月が入っていないこともあります。
          このシステムはファイル名を見ず、列の見出し(中身)でどの帳票かを見分け、
          何年何月分かもファイルの中身(Excelの見出しやCSVの日付)から判定します。
          中身から年月が決まらない帳票は、取込のときに画面で選んでいただきます。
          読み取れない・数字が合わないときは、画面をそのままスクリーンショットでご連絡ください。
        </p>
      </div>
    </section>
  );
}
