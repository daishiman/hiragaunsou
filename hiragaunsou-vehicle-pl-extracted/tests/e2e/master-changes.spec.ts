import { test, expect } from "@playwright/test";
import {
  createTestUser,
  deleteTestUserByEmail,
  clearRateLimits,
} from "./helpers/testUsers";
import { getSessionCookie, injectSessionCookie } from "./helpers/loginAs";

// ローカルD1(SQLite)は同時書き込みに弱いので、このファイルは直列で流す。
test.describe.configure({ mode: "serial" });

/**
 * マスタを直したあとの反映まわりを、実際の画面で確認する。
 *
 * 見たいのは
 *   1. 管理者だけが「直した内容の反映」を開けること
 *   2. 食い違いが無いときに、空の枠や意味の分からない数字を出さないこと
 *   3. 運転者マスタ・車両マスタを画面から1件ずつ直せる入口があること
 * の3点。反映そのものの正しさは tests/usecase 側で見ている。
 */
test.describe("マスタの直しの反映(管理者)", () => {
  const email = "e2e-master-changes@senpai-lab.com";
  const password = "TestPassw0rd!Master";
  let cookie: Awaited<ReturnType<typeof getSessionCookie>>;

  test.beforeAll(async ({ baseURL }) => {
    await clearRateLimits();
    await createTestUser({ email, password, name: "E2E反映管理者", role: "admin" });
    cookie = await getSessionCookie(baseURL!, email, password);
  });

  test.afterAll(async () => {
    await deleteTestUserByEmail(email);
  });

  test.beforeEach(async ({ context }) => {
    await injectSessionCookie(context, cookie);
  });

  test("サイドバーから「直した内容の反映」を開ける", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "直した内容の反映" }).click();
    await expect(page).toHaveURL(/\/master-changes$/);
    await expect(page.getByRole("heading", { name: "直した内容の反映" })).toBeVisible();
  });

  /*
    食い違いが有るか無いかは、そのローカルD1に何を取り込んであるかで変わる(実データを
    入れた環境では有る側になる)。データの中身に賭けたテストは、確認用に月次データを
    入れただけで落ちて原因を探させるので、どちらの状態でも「空の枠だけが残っていないこと」
    を見る形にする。
  */
  test("食い違いの有無どちらでも、空の枠や押せないボタンを残さない", async ({ page }) => {
    await page.goto("/master-changes");
    const empty = page.getByText("いま食い違っている月はありません");
    const summary = page.getByText(/締めた月のうち \d+件が、いまのマスタと違います/);
    await expect(empty.or(summary).first()).toBeVisible();

    if (await empty.isVisible()) {
      // 押せるものが無いのに操作ボタンだけ残っていると、押し先を探して迷う
      await expect(page.getByRole("button", { name: "まとめて反映する" })).toHaveCount(0);
      return;
    }
    // 並んでいるときは、月ごとに何をすればよいかが必ず添えてある
    await expect(page.getByRole("button", { name: "この月に反映する" }).first()).toBeVisible();
  });

  test("運転者マスタの一覧から1件ずつ直せる", async ({ page }) => {
    await page.goto("/admin/driver-master");
    await expect(page.getByRole("heading", { name: "運転者マスタ管理" })).toBeVisible();
    // 1名も登録されていないローカルでは一覧そのものが出ないので、その場合は入口の有無だけ見る
    const rows = page.locator("table tbody tr");
    if ((await rows.count()) > 0) {
      await expect(page.getByRole("button", { name: "直す" }).first()).toBeVisible();
    }
  });
});

test.describe("マスタの直しの反映(入力担当)", () => {
  const email = "e2e-master-changes-staff@senpai-lab.com";
  const password = "TestPassw0rd!Staff";
  let cookie: Awaited<ReturnType<typeof getSessionCookie>>;

  test.beforeAll(async ({ baseURL }) => {
    await clearRateLimits();
    await createTestUser({ email, password, name: "E2E入力担当", role: "input_staff" });
    cookie = await getSessionCookie(baseURL!, email, password);
  });

  test.afterAll(async () => {
    await deleteTestUserByEmail(email);
  });

  test.beforeEach(async ({ context }) => {
    await injectSessionCookie(context, cookie);
  });

  test("入力担当のサイドバーには「直した内容の反映」を出さない(開けない画面は見せない)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "直した内容の反映" })).toHaveCount(0);
  });
});
