import { test } from "@playwright/test";
import fs from "node:fs";
import {
  clearMasterImportTestData,
  clearRateLimits,
  createTestUser,
  deleteTestUserByEmail,
} from "./helpers/testUsers";
import { getSessionCookie, injectSessionCookie } from "./helpers/loginAs";
import { buildAnnualWorkbookFixture } from "../fixtures/monthlyPlWorkbook";

/** 一時計測用。取込前の確認パネルの文字数を数える。 */
const email = "measure-panel@example.com";
const password = "MeasurePassw0rd!";
const OUT = process.env.MEASURE_OUT ?? "/tmp/measure";
const EXCEL_NAME = "★車両別収支計算用2026年5月.xlsx";

const WORKBOOK = Buffer.from(
  buildAnnualWorkbookFixture([
    {
      sheetName: "5月収支表",
      heading: "令和8年5月車両別収支表",
      vehicleRows: [{ no: 24, type: "大型", depot: "本社", code: "93", driver: "浅沼　秀敏" }],
    },
  ]),
);

const testData = {
  actorEmail: email,
  vehicleNos: ["24"],
  employeeCodes: ["93"],
  fileNames: [EXCEL_NAME],
};

test.describe.configure({ mode: "serial" });

test("取込前の確認パネルの文字数", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  await clearRateLimits();
  await deleteTestUserByEmail(email);
  await createTestUser({ email, password, name: "計測用管理者", role: "admin" });
  await clearMasterImportTestData(testData);
  const cookie = await getSessionCookie(baseURL!, email, password);
  await injectSessionCookie(context, cookie);

  async function selectFile() {
    await page.goto("/admin/vehicle-master", { waitUntil: "domcontentloaded" });
    await page.setInputFiles('input[type="file"]', {
      name: EXCEL_NAME,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: WORKBOOK,
    });
    await page.waitForTimeout(1500);
  }

  // 1回目: 取り込んで記録を作る
  await selectFile();
  const confirmButton = page.getByRole("button", { name: /件を取り込む/ });
  if ((await confirmButton.count()) > 0) {
    await confirmButton.first().click();
    await page.waitForTimeout(1500);
  }

  // 2回目: 「取り込み済みです」の確認パネルが出る
  await selectFile();
  const panel = page.locator('[role="status"]').first();
  const text = (await panel.count()) > 0 ? await panel.innerText() : "(パネルが出ませんでした)";
  const chars = text.replace(/\s/g, "").length;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/panel.tsv`, `取込前の確認パネル\t${chars}\n${text}`);
  console.log(`取込前の確認パネル\t${chars}`);

  await clearMasterImportTestData(testData);
  await deleteTestUserByEmail(email);
});
