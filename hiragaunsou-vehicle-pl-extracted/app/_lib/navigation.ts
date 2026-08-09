import {
  KIND_LABELS,
  SCREEN_GROUPS,
  SCREENS,
  findScreen,
  visibleScreens,
  type ScreenBadge,
  type ScreenDef,
  type ScreenKind,
  type ScreenPlacement,
} from "./screens";
import { hasPermission } from "../../src/domain/rules/permissions";

/**
 * サイドバーのナビゲーション定義。
 *
 * 実体は持たない。グループ・並び順・項目名・ホバー説明はすべて
 * app/_lib/screens.ts の SCREENS / SCREEN_GROUPS から導出する。
 * サイドバーとページ見出しが別々に文言を持つと、同じ画面が場所によって
 * 違う名前で呼ばれる(「チェック」と「収支表のチェック(STEP7)」)。
 * 呼び名を1箇所に集めるための薄い変換層がこのファイル。
 */
export type NavBadge = ScreenBadge;

export interface NavItem {
  href: string;
  /** サイドバーに出す短い名前。 */
  label: string;
  /** ヘッダーの現在地表示に使う短い説明 */
  desc: string;
  badge?: NavBadge;
  /** この画面を開くのに要る権限。省略時はログインのみで開ける。 */
  permission?: ScreenDef["permission"];
}

export interface NavGroup {
  label: string;
  /** ページ種別バッジ (page-kind) の色分けキー */
  kind: ScreenKind;
  items: NavItem[];
}

export { KIND_LABELS };

function toNavItem(s: ScreenDef): NavItem {
  return {
    href: s.href,
    label: s.label,
    desc: s.desc,
    ...(s.badge ? { badge: s.badge } : {}),
    ...(s.permission ? { permission: s.permission } : {}),
  };
}

function buildGroups(screens: readonly ScreenDef[], placement: ScreenPlacement): NavGroup[] {
  return SCREEN_GROUPS.filter((g) => g.placement === placement)
    .map((g) => ({
      label: g.label,
      kind: g.kind,
      items: screens.filter((s) => s.group === g.id && !s.hiddenFromNav).map(toNavItem),
    }))
    .filter((g) => g.items.length > 0);
}

/** サイドバーに常時出すグループ。 */
export const NAV_GROUPS: readonly NavGroup[] = buildGroups(SCREENS, "sidebar");

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/**
 * サイドバー下部のユーザー名から開くメニューに入れるグループ。
 * 月1回も開かない運用・設定・仕様書の画面をここへ集め、常時見える選択肢を減らす。
 */
export const ACCOUNT_GROUPS: readonly NavGroup[] = buildGroups(SCREENS, "account");

export const ACCOUNT_ITEMS: readonly NavItem[] = ACCOUNT_GROUPS.flatMap((g) => g.items);

/**
 * サイドバーとアカウントメニューを合わせた、メニューから辿れる全画面。
 * 「どこからも辿れない画面」を作っていないことをテストで見張るために使う。
 */
export const ALL_MENU_ITEMS: readonly NavItem[] = [...NAV_ITEMS, ...ACCOUNT_ITEMS];

/**
 * ロールで開けない画面をサイドバーから除く。
 * 権限が無い画面をリンクとして見せてしまうと、押した瞬間に理由も分からずホームへ
 * 戻される(壊れたリンクに見える)ため、そもそも一覧に出さない。
 * 結果として空になったグループも表示しない。
 */
export function visibleNavGroups(role: string): NavGroup[] {
  return buildGroups(visibleScreens(role), "sidebar");
}

/** アカウントメニュー側も同じ基準で、開けない画面は出さない。 */
export function visibleAccountGroups(role: string): NavGroup[] {
  return buildGroups(visibleScreens(role), "account");
}

/** その画面がアカウントメニュー側にあるか (現在地の表示をどちらに出すかの判定に使う)。 */
export function isAccountScreen(href: string): boolean {
  return ACCOUNT_ITEMS.some((i) => i.href === href);
}

/** パスに対応するナビ項目 (最長一致)。該当なしは null。 */
export function findNavItem(pathname: string): NavItem | null {
  const screen = findScreen(pathname);
  return screen ? toNavItem(screen) : null;
}

/** ナビ項目が属するグループの kind (page-kind バッジ用) */
export function kindOf(href: string): ScreenKind | null {
  return SCREENS.find((s) => s.href === href)?.kind ?? null;
}

/** ロールがその画面を開けるか (ページ側 checkAccess と同じ基準) */
export function canOpen(role: string, href: string): boolean {
  const screen = SCREENS.find((s) => s.href === href);
  if (!screen) return false;
  return !screen.permission || hasPermission(role, screen.permission);
}
