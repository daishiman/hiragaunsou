import type { ReactNode } from "react";

/**
 * 「戻る」「ここまでを保存」「次へ」のような、その画面の主な操作を下に貼り付けておく帯 (全画面共通)。
 *
 * 表が何十行もある画面では、操作列がページの一番下にあると画面外に出てしまい、
 * 保存できることに気づかないまま画面を閉じてしまう。保存の入口は常に見えている必要がある。
 *
 * position: fixed ではなく sticky を使う。fixed だとサイドバーの幅ぶんの左寄せを
 * 自分で計算し直すことになり、画面幅が変わるたびにずれる。sticky なら本文の列の中に
 * 収まったまま下端に貼り付くので、幅の計算が要らない。
 *
 * 負の下マージン (-mb-6 / lg:-mb-8 / card は -mb-5) は main・カードの下余白の打ち消し。
 * 一番下までスクロールしたときに帯の下に中途半端な余白が残らないようにする。
 *
 * この打ち消しは「帯が親の最後の要素である」ことが前提で、後ろに要素が続くと
 * 打ち消したぶんだけその要素が帯の下へ食い込み、浮いている帯と重なって読めなくなる
 * (率マスタ設定で実際に起きた: 保存ボタンと説明の折りたたみが重なった)。
 * そこで打ち消しは last: 付きにして、前提が崩れた画面では効かないようにしてある。
 * 帯の後ろに要素を置いた画面は、重なる代わりに帯の下に余白が出る (読めなくはならない)。
 * ただし本来の並びは「帯が最後」なので、余白が出たら並び順のほうを直すこと。
 */
export function StickyActionBar({
  children,
  /** 帯の上に出す一行 (保存していない旨の注意など)。操作より先に読ませたいものだけ置く */
  notice,
  /**
   * page: 画面全体の操作 (本文の左右余白いっぱいに広げる)
   * card: 1枚のカードの中の操作 (カードの内側の余白に合わせ、下端で角を丸める)
   */
  variant = "page",
}: {
  children: ReactNode;
  notice?: ReactNode;
  variant?: "page" | "card";
}) {
  const inset =
    variant === "page"
      ? "-mx-4 mt-6 px-4 last:-mb-6 lg:-mx-8 lg:px-8 lg:last:-mb-8"
      : "-mx-5 mt-5 rounded-b-xl px-5 last:-mb-5";
  return (
    <div
      className={`screen-action-bar sticky bottom-0 z-20 border-t border-line bg-white/95 py-3 backdrop-blur ${inset}`}
    >
      {notice ? <div className="mb-2">{notice}</div> : null}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
