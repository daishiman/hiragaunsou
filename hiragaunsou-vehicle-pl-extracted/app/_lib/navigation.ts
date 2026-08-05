import { hasPermission, type Permission } from "../../src/domain/rules/permissions";

/**
 * サイドバーのナビゲーション定義。
 * グループ名・並び順・バッジの有無を実際の利用実態に合わせて調整している。
 * ユーザーの主目的は分析(儲かっているか)であり、入力作業(毎月の締め)はそのための手段でしかない
 * ため、「分析」グループは「現状データ」より前に置く。
 */
export type NavBadge = "registration" | "anomaly";

export interface NavItem {
  href: string;
  /**
   * サイドバーに出す短い名前。
   * 「データ取込(STEP1・2・4・7)」のように括弧書きを label に詰めると、
   * ナビが読み物になって一覧性が死ぬ。STEP番号は step フィールドに分け、
   * 小さなチップとして脇に置く。
   */
  label: string;
  /** 担当するSTEP番号 (業務フロー順の画面のみ) */
  step?: string;
  /** ヘッダーの現在地表示に使う短い説明 */
  desc: string;
  badge?: NavBadge;
  /**
   * この画面を開くのに要る権限。省略時はログインのみで開ける(ホーム・仕様の合意等)。
   * ページ側の checkAccess と同じ基準をここでも持ち、権限が無いユーザーにはサイドバーへ
   * そもそも出さない(要件定義4章「ロール外への画面露出は不可」)。
   * これが無いと、権限の無いページへのリンクを押しても理由の説明なくホームへ戻され、
   * リンクが壊れているように見えてしまう。
   */
  permission?: Permission;
}

export interface NavGroup {
  label: string;
  /** ページ種別バッジ (page-kind) の色分けキー */
  kind: "ops" | "data" | "analysis" | "spec" | "tool";
  items: NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "分析",
    kind: "analysis",
    items: [
      {
        href: "/dashboard",
        label: "ダッシュボード",
        desc: "期間の損益・推移・赤字車両・営業所別",
        permission: "view",
      },
      {
        href: "/deficit",
        label: "赤字の理由",
        desc: "赤字を原因別に分けて打ち手に繋げる",
        permission: "view",
      },
      {
        href: "/report",
        label: "AI要因分析",
        desc: "損益変動の要因をAIが要約する",
        permission: "report_settings",
      },
    ],
  },
  {
    label: "毎月の締め(業務フロー順)",
    kind: "ops",
    items: [
      { href: "/", label: "ホーム", desc: "今やることを1つだけ案内します。まずはここから" },
      {
        href: "/import",
        label: "データ取込",
        step: "1・2・4・7",
        desc: "運行実績・売上モニタリスト・給与集計表・完成済み収支表を取込む",
        badge: "registration",
        permission: "input",
      },
      {
        href: "/cleansing",
        label: "データ整形",
        step: "2",
        desc: "傭車・2重計上の疑い・諸口の伝票を1件ずつ判断する",
        permission: "view",
      },
      {
        href: "/manual-entry",
        label: "手入力",
        step: "2・3・5・6",
        desc: "キリン配分・燃料費・修繕費・タイヤ・高速料金を請求書から入力する",
        permission: "input",
      },
      {
        href: "/anomaly",
        label: "チェック",
        step: "7",
        desc: "いつもと違う値を1件ずつ判定する",
        badge: "anomaly",
        permission: "view",
      },
    ],
  },
  {
    label: "現状データ(閲覧)",
    kind: "data",
    items: [
      {
        href: "/grid",
        label: "月次収支表",
        step: "8",
        desc: "車両×科目の収支をExcel互換で見る",
        permission: "view",
      },
      {
        href: "/annual",
        label: "年間集計・対前年",
        desc: "13ヶ月推移と前年比較・Excel突合",
        permission: "view",
      },
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
      { href: "/usage", label: "利用状況", desc: "AI利用の概算費用を確認する", permission: "view" },
      {
        href: "/ai-settings",
        label: "AI設定",
        desc: "AI分析に使うAPIキーを管理する",
        permission: "manage_api_keys",
      },
      { href: "/profile", label: "マイページ", desc: "自分のアカウント情報を確認・編集する" },
      {
        href: "/admin/users",
        label: "ユーザー管理",
        desc: "全ユーザーのロール変更・アカウント凍結を行う",
        permission: "manage_users",
      },
      {
        href: "/admin/import-batches",
        label: "取込データ管理",
        desc: "誤って取り込まれたデータを確認・削除する",
        permission: "manage_imports",
      },
      {
        href: "/admin/vehicle-master",
        label: "車両マスタ管理",
        desc: "収支表取込で自動更新される車両マスタを、必要に応じてCSVで手動補正する",
        permission: "manage_imports",
      },
    ],
  },
] as const;

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * ロールで開けない画面をサイドバーから除く。
 * 権限が無い画面をリンクとして見せてしまうと、押した瞬間に理由も分からずホームへ
 * 戻される(壊れたリンクに見える)ため、そもそも一覧に出さない。
 * 結果として空になったグループも表示しない。
 */
export function visibleNavGroups(role: string): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || hasPermission(role, i.permission)),
  })).filter((g) => g.items.length > 0);
}

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
