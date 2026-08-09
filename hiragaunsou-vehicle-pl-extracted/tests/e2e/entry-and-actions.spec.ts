import { test, expect } from "@playwright/test";
import { getPlatformProxy } from "wrangler";
import {
  clearRateLimits,
  createTestUser,
  deleteTestUserByEmail,
  withBusyRetry,
} from "./helpers/testUsers";
import { getSessionCookie, injectSessionCookie } from "./helpers/loginAs";
import { filterToVehicle } from "./helpers/manualEntry";

test.describe.configure({ mode: "serial" });

/**
 * 「手で入れる欄の作法」と「工程タブ・操作の帯が常に見えること」を画面から確かめる。
 *
 * 単体テストは1つの画面の中しか見ないため、
 *   - 保存して開き直したときに「自動のまま」と「人が入れた」が分かれたままか
 *   - 表を下までスクロールしても工程タブと保存ボタンが見えているか
 * は取りこぼす。この2点は「誰も見ていない数字が確定する」「保存できることに気づかない」
 * という業務側の事故に直結するので、実際に動かして固定する。
 */
const YEAR_MONTH = "2026-05";
const VEHICLE_NOS = ["9201", "9202"] as const;
/** 自動計算の元になる値。通行料金は売上モニタリスト由来 = 前回計算した収支表の値。 */
const TOLL = 50000;
const TOLL_DISCOUNT = 17800; // 50000 × 組合割引率 0.356
const KM = 10000;

async function withLocalDb<T>(run: (db: D1Database) => Promise<T>): Promise<T> {
  const proxy = await getPlatformProxy();
  try {
    return await withBusyRetry(() => run((proxy.env as unknown as { DB: D1Database }).DB));
  } finally {
    await proxy.dispose();
  }
}

/** 自動計算の値が出る状態(車両マスタ + 前回の収支表の行)をD1に直接作る。 */
async function seed(): Promise<void> {
  await withLocalDb(async (DB) => {
    await DB.batch([
      ...VEHICLE_NOS.map((no) =>
        DB.prepare(
          "INSERT INTO vehicle_master (vehicle_no, vehicle_type, depot, cost_category, active) VALUES (?, '大型', '本社', 'large', 1)",
        ).bind(no),
      ),
      ...VEHICLE_NOS.map((no) =>
        DB.prepare(
          "INSERT INTO vehicle_pl (id, year_month, vehicle_no, type, depot, km, toll) VALUES (?, ?, ?, '大型', '本社', ?, ?)",
        ).bind(`e2e-entry-pl-${no}`, YEAR_MONTH, no, KM, TOLL),
      ),
    ]);
  });
}

async function clearTestData(): Promise<void> {
  await withLocalDb(async (DB) => {
    const nos = VEHICLE_NOS.map(() => "?").join(",");
    await DB.batch([
      DB.prepare(`DELETE FROM manual_vehicle_input WHERE vehicle_no IN (${nos})`).bind(
        ...VEHICLE_NOS,
      ),
      DB.prepare(`DELETE FROM vehicle_pl WHERE vehicle_no IN (${nos})`).bind(...VEHICLE_NOS),
      DB.prepare(`DELETE FROM vehicle_master WHERE vehicle_no IN (${nos})`).bind(...VEHICLE_NOS),
    ]);
  });
}

test.describe("手で入れる欄の作法と、常に見える工程タブ・操作", () => {
  const email = "e2e-entry@senpai-lab.com";
  const password = "TestPassw0rd!Entry";
  let cookie: Awaited<ReturnType<typeof getSessionCookie>>;

  test.beforeAll(async ({ baseURL }) => {
    await clearRateLimits();
    await clearTestData();
    await deleteTestUserByEmail(email);
    await createTestUser({ email, password, name: "E2E入力担当", role: "admin" });
    cookie = await getSessionCookie(baseURL!, email, password);
    await seed();
  });

  test.afterAll(async () => {
    await clearTestData();
    await deleteTestUserByEmail(email);
  });

  test.beforeEach(async ({ context }) => {
    await injectSessionCookie(context, cookie);
  });

  test("自動計算の金額は欄の中に入り、薄い文字と印で『自動のまま』と分かる", async ({ page }) => {
    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=6`);
    await filterToVehicle(page, VEHICLE_NOS[0]);

    const toll = page.getByLabel(`${VEHICLE_NOS[0]}番の通行料金(円)`);
    // 欄の外に「自動 50,000」と出すのではなく、欄の中に初期値として入っている
    await expect(toll).toHaveValue(String(TOLL));
    await expect(toll).toHaveAttribute("data-auto", "true");
    // 割引額も同じ作法 (通行料金 × 組合割引率)
    await expect(page.getByLabel(`${VEHICLE_NOS[0]}番の割引額(円)`)).toHaveValue(
      String(TOLL_DISCOUNT),
    );
  });

  test("手で直すと自動の印が外れ、『自動に戻す』で元へ戻せる", async ({ page }) => {
    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=6`);
    await filterToVehicle(page, VEHICLE_NOS[0]);

    const toll = page.getByLabel(`${VEHICLE_NOS[0]}番の通行料金(円)`);
    await toll.fill("61000");
    await expect(toll).toHaveValue("61000");
    await expect(toll).not.toHaveAttribute("data-auto", "true");

    await page.getByRole("button", { name: "自動に戻す" }).first().click();
    await expect(page.getByLabel(`${VEHICLE_NOS[0]}番の通行料金(円)`)).toHaveValue(String(TOLL));
    await expect(page.getByLabel(`${VEHICLE_NOS[0]}番の通行料金(円)`)).toHaveAttribute(
      "data-auto",
      "true",
    );
  });

  test("保存して開き直しても『自動のまま』と『人が入れた』は分かれたまま", async ({ page }) => {
    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=6`);
    await filterToVehicle(page, VEHICLE_NOS[0]);

    // 1台目だけ手で直し、2台目は自動のままにする
    await page.getByLabel(`${VEHICLE_NOS[0]}番の通行料金(円)`).fill("61000");
    await page.getByRole("button", { name: "ここまでを保存" }).click();
    await expect(page.getByText("保存しました")).toBeVisible();

    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=6`);
    await filterToVehicle(page, VEHICLE_NOS[0]);
    const edited = page.getByLabel(`${VEHICLE_NOS[0]}番の通行料金(円)`);
    await expect(edited).toHaveValue("61000");
    // 人が入れた値なので、自動の印は付かない
    await expect(edited).not.toHaveAttribute("data-auto", "true");

    // 触っていない車両は自動のまま。保存で数字が確定してしまっていない。
    await filterToVehicle(page, VEHICLE_NOS[1]);
    const untouched = page.getByLabel(`${VEHICLE_NOS[1]}番の通行料金(円)`);
    await expect(untouched).toHaveValue(String(TOLL));
    await expect(untouched).toHaveAttribute("data-auto", "true");
  });

  test("表を下までスクロールしても、工程タブと保存の帯は見えている", async ({ page }) => {
    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=6`);
    const stepHeader = page.locator(".screen-step-header");
    const actionBar = page.locator(".screen-action-bar");
    await expect(stepHeader).toBeVisible();
    await expect(actionBar).toBeVisible();

    await page.mouse.wheel(0, 4000);
    await expect(stepHeader).toBeInViewport();
    await expect(actionBar).toBeInViewport();
    await expect(page.getByRole("button", { name: "ここまでを保存" })).toBeInViewport();
  });

  test("画面の高さが低いノートPCでも、工程タブ・保存・入力欄が同時に使える", async ({ page }) => {
    // 13インチのノートPCでブラウザのタブとブックマークが出ている状態を想定する
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=6`);

    await expect(page.locator(".screen-step-header")).toBeInViewport();
    await expect(page.locator(".screen-action-bar")).toBeInViewport();

    await filterToVehicle(page, VEHICLE_NOS[0]);
    const toll = page.getByLabel(`${VEHICLE_NOS[0]}番の通行料金(円)`);
    // キーボードで欄へ入っても、貼り付けた帯の下に隠れない
    await toll.focus();
    await expect(toll).toBeInViewport();
    await toll.fill("12345");
    await expect(toll).toHaveValue("12345");
  });

  test("スマートフォンの幅でも、入力欄と保存の帯が使える", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=6`);

    await expect(page.locator(".screen-step-header")).toBeVisible();
    await expect(page.getByRole("button", { name: "ここまでを保存" })).toBeInViewport();
  });
});
