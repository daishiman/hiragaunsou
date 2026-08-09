import type { Page } from "@playwright/test";

/**
 * サイドバー下部のアカウントメニューを開く。
 *
 * 月に1回も開かない画面 (マイページ・ユーザー管理・AI設定・利用状況・取込データ管理・
 * データ設計の説明) とログアウトは、常時サイドバーに並べるのをやめてここに畳んだ。
 * 畳んだ項目は閉じている間 DOM に無いので、リンクの有無を見るテストは必ずここを通す。
 *
 * 「出ないこと」を見るときも同じ。開かずに toHaveCount(0) を書くと、
 * 権限で消えているのか畳まれているだけなのかを区別できず、素通りする。
 */
export async function openAccountMenu(page: Page, userName: string) {
  const trigger = page.getByRole("button", { name: new RegExp(userName) });
  await trigger.click();
  return page.getByRole("menu");
}
