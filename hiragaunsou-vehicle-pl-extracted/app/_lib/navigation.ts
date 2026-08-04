/**
 * サイドバーのナビゲーション定義 (モック mock/index.html のグループ構成を正とする)。
 * グループ名・並び順・バッジの有無までモックに合わせる。
 * 「補助ツール」だけはモックに無い実装済み画面 (手入力・AI要因分析・利用状況) の受け皿。
 */
export type NavBadge = "registration" | "anomaly";

export interface NavItem {
  href: string;
  label: string;
  /** ヘッダーの現在地表示に使う短い説明 */
  desc: string;
  badge?: NavBadge;
}

export interface NavGroup {
  label: string;
  /** ページ種別バッジ (page-kind) の色分けキー */
  kind: "ops" | "data" | "analysis" | "spec" | "tool";
  items: NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "毎月の締め(業務フロー順)",
    kind: "ops",
    items: [
      { href: "/", label: "ホーム", desc: "今月の締めを業務フローの順に進める" },
      {
        href: "/import",
        label: "データ取込(STEP1・2・4)",
        desc: "運行実績・売上モニタリスト・給与集計表を取込む",
        badge: "registration",
      },
      {
        href: "/cleansing",
        label: "データ整形(STEP1)",
        desc: "傭車・2重計上の疑い・諸口の伝票を1件ずつ判断する",
      },
      {
        href: "/manual-entry",
        label: "手入力(STEP3・5・6)",
        desc: "燃料費・修繕費・タイヤ・高速料金を請求書から入力する",
      },
      {
        href: "/anomaly",
        label: "収支表のチェック(STEP7)",
        desc: "いつもと違う値を1件ずつ判定する",
        badge: "anomaly",
      },
    ],
  },
  {
    label: "現状データ(閲覧)",
    kind: "data",
    items: [
      { href: "/grid", label: "月次収支表(STEP8)", desc: "車両×科目の収支をExcel互換で見る" },
      { href: "/annual", label: "年間集計・対前年", desc: "12ヶ月推移と前年比較・Excel突合" },
    ],
  },
  {
    label: "分析",
    kind: "analysis",
    items: [
      { href: "/dashboard", label: "経営ダッシュボード", desc: "全社の損益とkm単価の分布" },
      { href: "/deficit", label: "赤字の理由(3分類)", desc: "赤字を原因別に分けて打ち手に繋げる" },
    ],
  },
  {
    label: "仕様の合意",
    kind: "spec",
    items: [
      { href: "/logic", label: "データ設計・自動化方針", desc: "どの数字がどこから来るかの合意" },
    ],
  },
  {
    label: "補助ツール",
    kind: "tool",
    items: [
      { href: "/report", label: "AI要因分析", desc: "損益変動の要因をAIが要約する" },
      { href: "/usage", label: "利用状況", desc: "AI利用の概算費用を確認する" },
    ],
  },
] as const;

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** パスに対応するナビ項目 (最長一致)。該当なしは null。 */
export function findNavItem(pathname: string): NavItem | null {
  if (pathname === "/") return NAV_ITEMS.find((i) => i.href === "/") ?? null;
  const matches = NAV_ITEMS.filter((i) => i.href !== "/" && pathname.startsWith(i.href));
  if (matches.length === 0) return null;
  return matches.reduce((best, i) => (i.href.length > best.href.length ? i : best));
}

/** ナビ項目が属するグループの kind (page-kind バッジ用) */
export function kindOf(href: string): NavGroup["kind"] | null {
  return NAV_GROUPS.find((g) => g.items.some((i) => i.href === href))?.kind ?? null;
}

export const KIND_LABELS: Record<NavGroup["kind"], string> = {
  ops: "毎月の締め",
  data: "現状データ",
  analysis: "分析",
  spec: "仕様の合意",
  tool: "補助ツール",
};
