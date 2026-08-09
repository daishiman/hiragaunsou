import { expect, type Page } from "@playwright/test";

/**
 * 手入力の表を1台に絞り込み、**表が描き終わるまで待つ**。
 *
 * 検索欄に打ってすぐ金額欄を触ると、直後に表が描き直されて打った値が消えることがある。
 * 表の中身はサーバーから届いてから描かれるので、届く前に欄を掴むと、
 * 掴んだ欄が捨てられて新しい欄に置き換わるため。
 * 実際にCIで「12345 と打ったのに 61000 のまま」という形で落ちた。
 *
 * 待つ手がかりは画面に出ている「表示 N台 / 全 M台」。
 * この数が絞り込み後の台数になっていれば、表は確実に描き終わっている。
 */
export async function filterToVehicle(page: Page, vehicleNo: string, expectedCount = 1) {
  await page.getByPlaceholder("車番・運転者で検索").fill(vehicleNo);
  await expect(page.getByText(new RegExp(`表示 ${expectedCount}台 / 全 \\d+台`))).toBeVisible();
}
