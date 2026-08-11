import { hasPermission, type Permission } from "../../src/domain/rules/permissions";

/**
 * 画面の情報設計の唯一の定義。
 *
 * ここ1ファイルだけを直せば、以下すべてに同じ内容が反映される。
 *   - サイドバーのグループ・並び順・項目名・ホバー説明 (app/_lib/navigation.ts が導出)
 *   - 各画面のページ見出し・リード文・種別バッジ (app/_components/ScreenHeader.tsx が描画)
 *   - 各画面の「この画面ですること / ここでは見ないこと / 次にどこへ行くか」
 *   - 毎月の締めの工程順と、前の工程・次の工程への導線
 *
 * 画面ごとに文言を書き散らすと、同じ画面をサイドバーでは「チェック」、
 * ページの見出しでは「収支表のチェック(業務フロー STEP7)」と呼ぶような食い違いが起きる。
 * 呼び名も説明も、この表の1行が正となる。
 *
 * 画面を1枚足すときにやること: この配列に1件足すだけ。ページ側は
 * <ScreenHeader screen="/新しい画面" /> を書けば見出し・リード・役割説明が揃う。
 */

/** ページ種別バッジの色分けキー。サイドバーのグループ見出しとも対応する。 */
export type ScreenKind = "analysis" | "ops" | "data" | "master" | "spec" | "tool";

/** サイドバーのグループID。並び順は SCREEN_GROUPS の定義順。 */
export type ScreenGroupId =
  | "analysis"
  | "monthly"
  | "result"
  | "master"
  | "spec"
  | "account"
  | "reflect";

/**
 * サイドバーに出す件数バッジの種類。
 *
 * 「その数字が無いと、画面を開くまで分からないことがあるか?」を満たすものだけを置く。
 * anomaly(未判定の件数)は「まだ手が残っているか」が開かずに分かる唯一の手がかりなので残す。
 * かつてあった registration(登録済み台数)は、見ても次の行動が変わらないため廃止した。
 */
export type ScreenBadge = "anomaly";

/**
 * そのグループをどこに置くか。
 *   sidebar — 常時サイドバーに出す。毎月の締めで何度も行き来する業務の画面。
 *   account — サイドバー下部のユーザー名から開くメニューに入れる。
 *             月1回も開かない運用・設定・仕様書の画面。常時見えていても選択肢を増やすだけで、
 *             「これが無いと何が分からないか」に答えられない。
 */
export type ScreenPlacement = "sidebar" | "account";

/** 「ここでは見ないこと」「次にすること」で使う一言 + 行き先 */
export interface ScreenPointer {
  /** 業務の言葉で書いた一文 */
  text: string;
  /** 行き先。同じ画面内で完結する説明ならば省略する */
  href?: string;
  /** リンクに出す短い名前。省略時は行き先の画面名を使う */
  linkLabel?: string;
}

export interface ScreenDef {
  /** 画面のパス。動的ルートは先頭部分だけを書く (例: /vehicle) */
  href: string;
  /** サイドバー・パンくずに出す短い名前 */
  label: string;
  /** ページ見出し(h1)。サイドバー名より少し詳しくてよい */
  title: string;
  /** サイドバーのホバー説明。1行で読み切れる長さにする */
  desc: string;
  /** ページ見出しの下に出す説明。「何を見て何をする画面か」を1〜2文で */
  lead: string;
  /** この画面ですること。動詞で終える */
  does: string;
  /** ここでは見ない/できないこと。重複して見える隣の画面を必ず名指しする */
  notHere?: ScreenPointer;
  /** この画面が終わったら次にどこへ行くか */
  next?: ScreenPointer;
  group: ScreenGroupId;
  kind: ScreenKind;
  /**
   * 毎月の締めの工程順 (1始まり)。持っている画面だけが
   * 「毎月の締め n/5」「前の工程 / 次の工程」の導線を出す。
   */
  flowOrder?: number;
  badge?: ScreenBadge;
  /**
   * この画面を開くのに要る権限。省略時はログインのみで開ける。
   * ページ側の checkAccess と同じ基準をここにも持ち、権限が無い人には
   * サイドバーにそもそも出さない(押しても理由なくホームへ戻される状態を作らない)。
   */
  permission?: Permission;
  /** サイドバーに出さない画面 (一覧から辿る詳細画面など) */
  hiddenFromNav?: boolean;
}

export const SCREEN_GROUPS: readonly {
  id: ScreenGroupId;
  label: string;
  kind: ScreenKind;
  placement: ScreenPlacement;
}[] = [
  { id: "analysis", label: "儲かっているかを見る", kind: "analysis", placement: "sidebar" },
  { id: "monthly", label: "毎月の締め（この順に進む）", kind: "ops", placement: "sidebar" },
  { id: "result", label: "できあがった収支表", kind: "data", placement: "sidebar" },
  { id: "master", label: "計算の基準（先に登録しておく）", kind: "master", placement: "sidebar" },
  // 読むだけの仕様書。毎月の作業では開かないので、常時サイドバーに置かず
  // ユーザー名から開くメニューへ入れる (置き場所の判断は docs/design-system-components.md §11-9)。
  { id: "spec", label: "仕組みの説明", kind: "spec", placement: "account" },
  // 自分のアカウント・利用者の管理・APIキー・取込の後始末。いずれも業務ではなく運用の画面で、
  // 月に1回も開かない。常時見せると選択肢だけが増えるため、ユーザー名のメニューに集約する。
  { id: "account", label: "アカウント・管理", kind: "tool", placement: "account" },
  // 依頼者の指示: 「直した内容の反映」は率マスタ・車両マスタ・運転者マスタとは性質が違う
  // (マスタを直す画面ではなく、直した結果を締めた月へ反映するか決める画面) ため一番下に置く。
  { id: "reflect", label: "直した内容の反映（最後に確認）", kind: "master", placement: "sidebar" },
] as const;

export const KIND_LABELS: Record<ScreenKind, string> = {
  analysis: "分析",
  ops: "毎月の締め",
  data: "できあがった収支表",
  master: "計算の基準",
  spec: "仕組みの説明",
  tool: "設定・管理",
};

import { SCREENS } from "./screens.catalog";

export { SCREENS } from "./screens.catalog";

/** パス → 画面定義。ScreenHeader はこれ1本で引く。 */
const BY_HREF = new Map(SCREENS.map((s) => [s.href, s]));

export function getScreen(href: string): ScreenDef | null {
  return BY_HREF.get(href) ?? null;
}

/**
 * パスに対応する画面 (最長一致)。/vehicle/1177 のような詳細ページも拾う。
 */
export function findScreen(pathname: string): ScreenDef | null {
  if (pathname === "/") return getScreen("/");
  const matches = SCREENS.filter((s) => s.href !== "/" && pathname.startsWith(s.href));
  if (matches.length === 0) return null;
  return matches.reduce((best, s) => (s.href.length > best.href.length ? s : best));
}

/** 毎月の締めの工程 (flowOrder を持つ画面) を順番に並べたもの。 */
export const FLOW_SCREENS: readonly ScreenDef[] = SCREENS.filter(
  (s) => s.flowOrder !== undefined,
).sort((a, b) => (a.flowOrder ?? 0) - (b.flowOrder ?? 0));

export interface FlowPosition {
  /** 1始まりの現在位置 */
  index: number;
  total: number;
  prev: ScreenDef | null;
  next: ScreenDef | null;
}

/** 工程の何番目か + 前後の工程。工程に属さない画面は null。 */
export function flowPositionOf(href: string): FlowPosition | null {
  const i = FLOW_SCREENS.findIndex((s) => s.href === href);
  if (i < 0) return null;
  return {
    index: i + 1,
    total: FLOW_SCREENS.length,
    prev: i > 0 ? (FLOW_SCREENS[i - 1] ?? null) : null,
    next: i < FLOW_SCREENS.length - 1 ? (FLOW_SCREENS[i + 1] ?? null) : null,
  };
}

/** ロールで開ける画面だけに絞る。 */
export function visibleScreens(role: string): ScreenDef[] {
  return SCREENS.filter((s) => !s.permission || hasPermission(role, s.permission));
}
