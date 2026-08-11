/**
 * アプリで使うアイコンの最小セット。
 *
 * なぜ1ファイルに集約するか:
 *   画面ごとに <svg> を書き起こすと、線の太さも角の丸みもサイズもバラバラになり、
 *   結果として「素人が描いた絵」が並ぶ。docs/design-system.md が絵文字と自作アイコンを
 *   禁じているのはそのため。ここでは形の規格 (24×24 / 線幅1.5 / 端は丸め / 塗りなし) を
 *   1箇所で固定し、追加するときも必ずこの表に足す。
 *
 * 形は Lucide (ISCライセンス) と同じ幾何を用いている。世の中の多くのアプリが使っている
 * 図形なので、初めて見た人でも意味が通る。独自の比喩を描き起こすことはしない。
 *
 * 増やすときの決まり:
 *   - 「操作」を表すものだけ。装飾・比喩 (電球・ロケットなど) は追加しない。
 *   - 追加する図形は既存のアイコンライブラリにある一般的な形から選ぶ。
 *   - アイコンだけで意味が一意に決まらないものは、そもそもアイコンにしない (文字で書く)。
 *     判断基準は docs/design-system-components.md §11-10。
 */

/** 使えるアイコンの名前。ここに無いものは使わない。 */
export type IconName =
  | "panel-left-close"
  | "panel-left-open"
  | "menu"
  | "close"
  | "chevron-down"
  | "chevron-up";

/** 名前 → 図形。すべて 24×24 の座標系で描く。 */
const PATHS: Record<IconName, React.ReactNode> = {
  // サイドバーを隠す (左の面が閉じる向きの矢印)
  "panel-left-close": (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </>
  ),
  // サイドバーを表示する (左の面が開く向きの矢印)
  "panel-left-open": (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d="m14 9 3 3-3 3" />
    </>
  ),
  // 細い画面でメニューを開く
  menu: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-up": <path d="m18 15-6-6-6 6" />,
};

export interface IconProps {
  name: IconName;
  /** 一辺の大きさ(px)。既定18は本文14pxの行に馴染む大きさ */
  size?: number;
  className?: string;
}

/**
 * アイコン1つ。必ず装飾扱い (aria-hidden) にする。
 * 意味は隣の文字か、包んでいるボタンの aria-label が担う。
 * アイコン自身に名前を持たせると、読み上げで名前が二重になる。
 */
export function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
