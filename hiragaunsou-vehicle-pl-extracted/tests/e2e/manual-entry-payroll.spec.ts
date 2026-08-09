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
 * 手入力 STEP4「人件費の確認」を画面から直せることを確かめる。
 *
 * 業務フロー仕様書の STEP4 は「給与集計表CSVを貼るだけ」で、手直しの手順が無い。
 * そのため画面も読むだけになっていたが、月中に車両を乗り換えた運転者の按分は
 * 人が直すしかない(vehiclePlOverride.ts の OVERRIDABLE_FIELDS に salary/welfare が
 * 元から入っているのはそのため)。単体テストでは「保存APIに何を送るか」までしか
 * 押さえられないので、開き直しても直した金額が残ることをここで固定する。
 */
const YEAR_MONTH = "2026-05";
const BATCH_ID = "e2e-payroll-batch";
const VEHICLE_NOS = ["9101", "9102"] as const;
const EMPLOYEE_CODES = ["E9101", "E9102"] as const;

async function withLocalDb<T>(run: (db: D1Database) => Promise<T>): Promise<T> {
  const proxy = await getPlatformProxy();
  try {
    // 他のspecと同時にローカルsqliteへ書くと一瞬弾かれることがある。待てば通るので作り直す。
    return await withBusyRetry(() => run((proxy.env as unknown as { DB: D1Database }).DB));
  } finally {
    await proxy.dispose();
  }
}

/** 給与集計表を取り込んだ直後の状態(車両マスタ・運転者マスタ・取込行)をD1に直接作る。 */
async function seedPayroll(): Promise<void> {
  await withLocalDb(async (DB) => {
    await DB.batch([
      ...VEHICLE_NOS.map((no) =>
        DB.prepare(
          "INSERT INTO vehicle_master (vehicle_no, vehicle_type, depot, cost_category, active) VALUES (?, '大型', '本社', 'large', 1)",
        ).bind(no),
      ),
      ...EMPLOYEE_CODES.map((code, i) =>
        DB.prepare(
          "INSERT INTO driver_master (employee_code, driver_name, vehicle_no) VALUES (?, ?, ?)",
        ).bind(code, `E2E運転者${i + 1}`, VEHICLE_NOS[i]),
      ),
      DB.prepare(
        "INSERT INTO csv_import_batch (id, source_type, year_month, file_name, row_count, status) VALUES (?, 'payroll', ?, 'E2E給与集計表.csv', 2, 'completed')",
      ).bind(BATCH_ID, YEAR_MONTH),
      ...EMPLOYEE_CODES.map((code, i) =>
        DB.prepare(
          "INSERT INTO raw_ingestion (id, batch_id, source_type, year_month, row_index, natural_key, raw_json) VALUES (?, ?, 'payroll', ?, ?, ?, ?)",
        ).bind(
          `e2e-payroll-row-${i}`,
          BATCH_ID,
          YEAR_MONTH,
          i,
          code,
          JSON.stringify({
            employeeCode: code,
            employeeName: `E2E運転者${i + 1}`,
            totalPay: 300000 + i * 10000,
            socialInsuranceTotal: 40000 + i * 1000,
          }),
        ),
      ),
    ]);
  });
}

async function clearPayrollTestData(): Promise<void> {
  await withLocalDb(async (DB) => {
    const nos = VEHICLE_NOS.map(() => "?").join(",");
    const codes = EMPLOYEE_CODES.map(() => "?").join(",");
    await DB.batch([
      DB.prepare(`DELETE FROM vehicle_pl_override WHERE vehicle_no IN (${nos})`).bind(
        ...VEHICLE_NOS,
      ),
      DB.prepare("DELETE FROM raw_ingestion WHERE batch_id = ?").bind(BATCH_ID),
      DB.prepare("DELETE FROM csv_import_batch WHERE id = ?").bind(BATCH_ID),
      DB.prepare(`DELETE FROM driver_master WHERE employee_code IN (${codes})`).bind(
        ...EMPLOYEE_CODES,
      ),
      DB.prepare(`DELETE FROM vehicle_master WHERE vehicle_no IN (${nos})`).bind(...VEHICLE_NOS),
    ]);
  });
}

test.describe("手入力 STEP4: 人件費を確認して直す", () => {
  const email = "e2e-payroll@senpai-lab.com";
  const password = "TestPassw0rd!Payroll";
  let cookie: Awaited<ReturnType<typeof getSessionCookie>>;

  test.beforeAll(async ({ baseURL }) => {
    await clearRateLimits();
    await clearPayrollTestData();
    await deleteTestUserByEmail(email);
    await createTestUser({ email, password, name: "E2E人件費担当", role: "admin" });
    cookie = await getSessionCookie(baseURL!, email, password);
    await seedPayroll();
  });

  test.afterAll(async () => {
    await clearPayrollTestData();
    await deleteTestUserByEmail(email);
  });

  test.beforeEach(async ({ context }) => {
    await injectSessionCookie(context, cookie);
  });

  test("直した金額は開き直しても残り、取込値と見分けられる", async ({ page }) => {
    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=4`);
    await expect(page.getByRole("heading", { name: "人件費(給与集計表)の確認" })).toBeVisible();

    // 探すのに時間を使わせないため、まず対象の車両だけに絞る。
    await filterToVehicle(page, VEHICLE_NOS[0]);

    const salary = page.getByLabel(`${VEHICLE_NOS[0]}番の総支給額(円)`);
    // 取込値が入った状態で開く(空欄から入力し直させない)。
    await expect(salary).toHaveValue("300000");

    await salary.fill("250000");
    await page.getByLabel(/直した理由/).fill("月中に車両を乗り換えたため按分");
    await page.getByRole("button", { name: "この車両を保存" }).click();
    await expect(page.getByText("保存しました")).toBeVisible();

    // 開き直しても直した金額のまま。他の欄と同じ作法で「取込値のまま」と見分けられる。
    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=4`);
    await filterToVehicle(page, VEHICLE_NOS[0]);
    const edited = page.getByLabel(`${VEHICLE_NOS[0]}番の総支給額(円)`);
    await expect(edited).toHaveValue("250000");
    // 人が直した欄なので、取込値のままを表す印は付かない。
    await expect(edited).not.toHaveAttribute("data-auto", "true");
    // 「手修正 1台」の件数表示ではなく、セルに添えた印であることまで確かめる。
    await expect(page.getByText("手修正", { exact: true })).toBeVisible();

    // 直していない車両は取込値のまま(1台直すと他が巻き込まれる、が起きない)。
    await filterToVehicle(page, VEHICLE_NOS[1]);
    const untouched = page.getByLabel(`${VEHICLE_NOS[1]}番の総支給額(円)`);
    await expect(untouched).toHaveValue("310000");
    await expect(untouched).toHaveAttribute("data-auto", "true");
  });

  test("取込値に戻すと元の金額に戻る", async ({ page }) => {
    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=4`);
    await filterToVehicle(page, VEHICLE_NOS[0]);
    await expect(page.getByLabel(`${VEHICLE_NOS[0]}番の総支給額(円)`)).toHaveValue("250000");

    await page.getByRole("button", { name: "取込値に戻す" }).click();
    await page.getByRole("button", { name: "この車両を保存" }).click();
    await expect(page.getByText("取込値に戻しました")).toBeVisible();

    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=4`);
    await filterToVehicle(page, VEHICLE_NOS[0]);
    await expect(page.getByLabel(`${VEHICLE_NOS[0]}番の総支給額(円)`)).toHaveValue("300000");
    await expect(page.getByText("手修正", { exact: true })).toHaveCount(0);
  });

  test("請求書から入力するステップ(燃料費・高速料金)はこれまで通り入力できる", async ({
    page,
  }) => {
    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=3`);
    await filterToVehicle(page, VEHICLE_NOS[0]);
    // 請求書を見て入れる欄。人件費と違い、取込値ではなく空欄から始まる。
    const adblue = page.getByLabel(`${VEHICLE_NOS[0]}番のアドブルー(円)`);
    await expect(adblue).toHaveValue("");
    await adblue.fill("1200");
    await expect(adblue).toHaveValue("1200");

    await page.goto(`/manual-entry?ym=${YEAR_MONTH}&step=6`);
    await expect(page.getByRole("heading", { name: "高速料金" })).toBeVisible();
    await filterToVehicle(page, VEHICLE_NOS[0]);
    await expect(page.getByLabel(`${VEHICLE_NOS[0]}番の通行料金(円)`)).toBeVisible();
  });
});
