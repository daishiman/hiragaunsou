import { test } from "@playwright/test";
import fs from "node:fs";
import { createTestUser, deleteTestUserByEmail, clearRateLimits } from "./helpers/testUsers";
import { getSessionCookie, injectSessionCookie } from "./helpers/loginAs";

/** 一時計測用。初期表示の文字数を数え、スクリーンショットを撮る。 */
const email = "measure-admin@example.com";
const password = "MeasurePassw0rd!";
const OUT = process.env.MEASURE_OUT ?? "/tmp/measure";

const SCREENS: readonly (readonly [string, string])[] = [
  ["ホーム", "/"],
  ["運転者マスタ管理", "/admin/driver-master"],
  ["車両マスタ管理", "/admin/vehicle-master"],
  ["率マスタ設定", "/rate-settings"],
  ["データ設計・自動化方針", "/logic"],
  ["月次データ取込", "/import"],
  ["ダッシュボード", "/dashboard"],
  ["月次収支表", "/grid"],
  ["年間集計・対前年", "/annual"],
  ["赤字の理由", "/deficit"],
  ["データ整形", "/cleansing"],
  ["手入力", "/manual-entry"],
  ["チェック", "/anomaly"],
  ["ToDoボード", "/todo"],
  ["利用状況", "/usage"],
  ["AI設定", "/ai-settings"],
  ["利用者の管理", "/admin/users"],
  ["取込データ管理", "/admin/import-batches"],
  ["車両1台の明細", "/vehicle/1"],
  ["見つからないページ", "/no-such-page"],
];

test.describe.configure({ mode: "serial" });

test.describe("初期表示の文字数計測", () => {
  let cookie: Awaited<ReturnType<typeof getSessionCookie>>;

  test.beforeAll(async ({ baseURL }) => {
    await clearRateLimits();
    await deleteTestUserByEmail(email);
    await createTestUser({ email, password, name: "計測用管理者", role: "admin" });
    cookie = await getSessionCookie(baseURL!, email, password);
  });

  test.afterAll(async () => {
    await deleteTestUserByEmail(email);
  });

  test("全画面", async ({ page, context }) => {
    test.setTimeout(180_000);
    await injectSessionCookie(context, cookie);
    fs.mkdirSync(OUT, { recursive: true });
    const rows: string[] = [];
    for (const [name, path] of SCREENS) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(400);
      const target = (await page.locator("main").count()) > 0 ? page.locator("main").first() : page.locator("body");
      const main = await target.innerText();
      const chars = main.replace(/\s/g, "").length;
      rows.push(`${name}\t${path}\t${chars}`);
      await page.screenshot({
        path: `${OUT}/${name}.png`,
        clip: { x: 0, y: 0, width: 1280, height: 720 },
      });
    }
    fs.writeFileSync(`${OUT}/counts.tsv`, rows.join("\n"));
    console.log(rows.join("\n"));
  });
});
