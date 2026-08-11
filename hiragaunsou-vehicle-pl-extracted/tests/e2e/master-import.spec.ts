import { test, expect } from "@playwright/test";
import {
  clearMasterImportTestData,
  clearRateLimits,
  createTestUser,
  deleteTestUserByEmail,
} from "./helpers/testUsers";
import { getSessionCookie, injectSessionCookie } from "./helpers/loginAs";
import { buildAnnualWorkbookFixture } from "../fixtures/monthlyPlWorkbook";

test.describe.configure({ mode: "serial" });

/**
 * 車両マスタ・運転者マスタが社内Excelから登録できることを、画面から実際に取り込んで確かめる。
 *
 * 直したのは「画面の既定の対象月(当月−2)のシートがExcelに無いと取込が必ず422で落ち、
 * 画面は0台のまま何も言わない」という壊れ方。単体テストだけでは、画面が送っている
 * 対象年月とAPIの受け取りがつながっているかまでは押さえられないため、ここで固定する。
 */
const EXCEL_NAME = "★車両別収支計算用2026年5月.xlsx";

/** 対象月として送られる月(既定は当月−2)より古い月しか持たない年度ブック。実データと同じ形。 */
function buildSourceWorkbook(): Buffer {
  return Buffer.from(
    buildAnnualWorkbookFixture([
      {
        sheetName: "4月収支表",
        heading: "令和8年4月車両別収支表",
        vehicleRows: [{ no: 24, type: "大型", depot: "本社", code: "93", driver: "浅沼　秀敏" }],
      },
      {
        sheetName: "5月収支表",
        heading: "令和8年5月車両別収支表",
        vehicleRows: [
          { no: 24, type: "大型", depot: "本社", code: "93", driver: "浅沼　秀敏" },
          { no: 300, type: "セミトレ", depot: "本社", code: "1002", driver: "鈴木一郎" },
        ],
      },
    ]),
  );
}

/**
 * 3つのテストで同じバイト列を使う(作り直すとZIPの内容が変わり「中身が同じ」の判定がぶれる)。
 * 実運用でもExcelを保存し直せば中身は別物になるので、同一ファイルの再選択はこの形で再現する。
 */
const SOURCE_WORKBOOK = buildSourceWorkbook();

test.describe("マスタ管理: 社内Excelをそのまま取り込む", () => {
  const email = "e2e-master@senpai-lab.com";
  const password = "TestPassw0rd!Master";
  let cookie: Awaited<ReturnType<typeof getSessionCookie>>;

  const testData = {
    actorEmail: email,
    vehicleNos: ["24", "300"],
    employeeCodes: ["93", "1002"],
    fileNames: [EXCEL_NAME],
  };

  test.beforeAll(async ({ baseURL }) => {
    await clearRateLimits();
    await clearMasterImportTestData(testData);
    await createTestUser({ email, password, name: "E2Eマスタ管理者", role: "admin" });
    cookie = await getSessionCookie(baseURL!, email, password);
  });

  test.afterAll(async () => {
    await clearMasterImportTestData(testData);
    await deleteTestUserByEmail(email);
  });

  test.beforeEach(async ({ context }) => {
    await injectSessionCookie(context, cookie);
  });

  test("車両マスタ: 対象月のシートが無いExcelでも、読んだシートを示して取り込める", async ({
    page,
  }) => {
    await page.goto("/admin/vehicle-master");
    await page.setInputFiles('input[type="file"]', {
      name: EXCEL_NAME,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: SOURCE_WORKBOOK,
    });

    await expect(page.getByRole("heading", { name: /取込内容の確認/ })).toBeVisible();
    await expect(page.getByText(/シート「5月収支表」/)).toBeVisible();
    await expect(page.getByText("取り込めませんでした")).toHaveCount(0);

    await page.getByRole("button", { name: /件を取り込む|台を取り込む/ }).click();
    await expect(page.getByText(/台を登録しました/)).toBeVisible();
    // 件数はローカルDBの中身に左右されるので、今回入れた車両が一覧に出たことで確かめる。
    await expect(page.getByRole("heading", { name: /現在の車両マスタ（\d+台）/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: "300", exact: true })).toBeVisible();
  });

  test("運転者マスタ: 同じExcelから社員Noと車番の対応を取り込める", async ({ page }) => {
    await page.goto("/admin/driver-master");
    await page.setInputFiles('input[type="file"]', {
      name: EXCEL_NAME,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: SOURCE_WORKBOOK,
    });

    await expect(page.getByRole("heading", { name: /取込内容の確認/ })).toBeVisible();
    await expect(page.getByText(/シート「5月収支表」/)).toBeVisible();

    await page.getByRole("button", { name: /名を取り込む/ }).click();
    await expect(page.getByText(/名を登録しました/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /現在の運転者マスタ\(\d+名/ })).toBeVisible();
    // 氏名のセルには「直す」の入口も入るので、完全一致では見ない
    await expect(page.getByRole("cell", { name: /鈴木一郎/ })).toBeVisible();
  });

  /**
   * 上の2件で同じExcelを別々の画面に取り込んでいる。これを「重複」と言わないこと
   * (画面をまたいだ照合はしない)と、同じ画面で2度目に選んだときは必ず確認が出ることを
   * まとめて固定する。仕様は docs/product/file-import-common-spec.md §3-5。
   */
  test("同じ画面に同じファイルを選び直すと、取込前に取り込み済みだと知らせる", async ({ page }) => {
    await page.goto("/admin/vehicle-master");
    await page.setInputFiles('input[type="file"]', {
      name: EXCEL_NAME,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: SOURCE_WORKBOOK,
    });

    await expect(page.getByText(/に取り込み済みです/)).toBeVisible();
    // 確認を挟むだけで、勝手に取り込みも中止もしない。
    await expect(page.getByRole("heading", { name: /取込内容の確認/ })).toHaveCount(0);

    await page.getByRole("button", { name: "それでも取り込む" }).click();
    await expect(page.getByRole("heading", { name: /取込内容の確認/ })).toBeVisible();

    // 取り込み済みの根拠は既存の「取込データ管理」から見えて、外せること。
    await page.goto("/admin/import-batches");
    await expect(page.getByRole("heading", { name: /取り込んだファイルの記録/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: EXCEL_NAME }).first()).toBeVisible();
  });
});
