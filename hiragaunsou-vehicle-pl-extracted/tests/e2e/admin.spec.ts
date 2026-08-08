import { test, expect } from "@playwright/test";
import { createTestUser, deleteTestUserByEmail, setUserBanned, clearRateLimits } from "./helpers/testUsers";
import { getSessionCookie, injectSessionCookie } from "./helpers/loginAs";

// ローカルD1(SQLite/miniflare)は同時書き込みに弱く、テストユーザー作成やsign-inの
// レート制限(IPベース)が並列実行だと競合するため、このファイルは直列実行に固定する。
test.describe.configure({ mode: "serial" });

/**
 * ログイン後の画面をE2Eで検証する。
 * Google OAuthは経由せず、本番コードが既に持つ招待経由メール/パスワード作成パス
 * (internalInviteProvisioning + auth.api.signUpEmail、app/api/admin/invitations/route.ts と同じ経路)
 * でテスト専用アカウントをローカルD1にのみ作成し、実際のsign-in APIでセッションを発行する。
 * 対象はローカル(`wrangler dev`がエミュレートするローカルD1)のみで、本番D1には一切触れない。
 *
 * sign-in APIはIPベースのレート制限があるため、describeごとにbeforeAllで1回だけサインインし、
 * 得たセッションCookieを各テストのbeforeEachで(新規生成される)contextへ注入して使い回す。
 */
test.describe("管理者ロールでのログイン後の画面", () => {
  const email = "e2e-admin@senpai-lab.com";
  const password = "TestPassw0rd!Admin";
  let cookie: Awaited<ReturnType<typeof getSessionCookie>>;

  test.beforeAll(async ({ baseURL }) => {
    await clearRateLimits();
    await createTestUser({ email, password, name: "E2Eテスト管理者", role: "admin" });
    cookie = await getSessionCookie(baseURL!, email, password);
  });

  test.afterAll(async () => {
    await deleteTestUserByEmail(email);
  });

  test.beforeEach(async ({ context }) => {
    await injectSessionCookie(context, cookie);
  });

  test("adminロールでログインするとサイドバーに管理者限定メニューが出る", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "AI設定" })).toBeVisible();
    await expect(page.getByRole("link", { name: "ユーザー管理" })).toBeVisible();
  });

  test("/admin/vehicle-master で車両マスタCSV取込画面が表示される", async ({ page }) => {
    await page.goto("/admin/vehicle-master");
    await expect(page).toHaveURL(/\/admin\/vehicle-master$/);
    await expect(page.getByRole("heading", { name: "車両マスタ管理" })).toBeVisible();
  });

  test("/admin/users でユーザー一覧が表示される", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(page.getByText(email)).toBeVisible();
  });

  test("/usage にAPIキー・モデル設定セクションが表示される(manage_api_keys保持者)", async ({
    page,
  }) => {
    await page.goto("/usage");
    await expect(page.getByRole("heading", { name: "APIキー・モデルの設定" })).toBeVisible();
    await expect(page.getByRole("link", { name: "AI設定ページを開く" })).toHaveAttribute(
      "href",
      "/ai-settings",
    );
  });

  test("共通ヘッダーに「年月度」の表示が出ない", async ({ page }) => {
    await page.goto("/usage");
    await expect(page.getByText(/\d{4}年\d{1,2}月度/)).toHaveCount(0);
  });

  test("/import で対象年月セレクタが1つだけ表示される(ヘッダー側の重複が解消済み)", async ({
    page,
  }) => {
    await page.goto("/import");
    await expect(page.getByLabel("対象年月")).toHaveCount(1);
  });

  // ログアウトはセッションを無効化するため、このdescribe内で最後に実行する。
  test("/profile でプロフィールが表示され、ログアウトすると/sign-inへ戻る", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByText(email)).toBeVisible();

    await page.getByRole("button", { name: "ログアウト", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});

test.describe("凍結(banned)ユーザーのログイン拒否", () => {
  const email = "e2e-banned@senpai-lab.com";
  const password = "TestPassw0rd!Banned";

  test.beforeAll(async () => {
    await clearRateLimits();
    await createTestUser({ email, password, name: "E2Eテスト凍結対象", role: "input_staff" });
  });

  test.afterAll(async () => {
    await deleteTestUserByEmail(email);
  });

  test("banned=trueのユーザーはsign-in APIが403を返し、新規セッションを作れない", async ({
    baseURL,
  }) => {
    await setUserBanned(email, true);
    const res = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseURL! },
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toBe("ACCOUNT_DISABLED");
  });
});

test.describe("車両マスタCSV取込・ym引き継ぎ・入力担当ロールの権限境界", () => {
  const email = "e2e-input-staff@senpai-lab.com";
  const password = "TestPassw0rd!Staff";
  let cookie: Awaited<ReturnType<typeof getSessionCookie>>;

  test.beforeAll(async ({ baseURL }) => {
    await clearRateLimits();
    await createTestUser({ email, password, name: "E2Eテスト入力担当", role: "input_staff" });
    cookie = await getSessionCookie(baseURL!, email, password);
  });

  test.afterAll(async () => {
    await deleteTestUserByEmail(email);
  });

  test.beforeEach(async ({ context }) => {
    await injectSessionCookie(context, cookie);
  });

  test("input_staffロールはサイドバーに管理者限定メニューが出ない", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "AI設定" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "ユーザー管理" })).toHaveCount(0);
  });

  /*
    以前は黙ってホームへ戻していたが、押した本人には「リンクが壊れている」としか見えなかった。
    画面の中身(ユーザー一覧)は今までどおり一切出さないまま、開けない理由だけを出す。
  */
  test("input_staffロールが/admin/usersを開くと、開けない理由と依頼先が出る", async ({
    page,
  }) => {
    await page.goto("/admin/users");
    await expect(page.getByText("「ユーザー管理」は管理者のみが開けます。")).toBeVisible();
    await expect(page.getByText("必要な場合は管理者にご依頼ください。")).toBeVisible();
    await expect(page.getByRole("link", { name: "ホームに戻る" })).toBeVisible();
    // 一覧そのものは描かない(露出の条件は変えていない)
    await expect(page.locator("table")).toHaveCount(0);
  });

  test("クレンジング画面(売上データ未取込)の導線リンクに対象年月(ym)が引き継がれる", async ({
    page,
  }) => {
    // ローカルD1は空データのため売上モニタリスト未取込状態(notImported=true)になり、
    // 「データ取込へ進む」の導線が出る(判断済み0件時の「次のステップへ進む」分岐は
    // CleansingQueue.tsx:521-531 で withYm("/manual-entry?step=2", yearMonth) を使っており、
    // 同じ withYm 実装がヘッダー/フッターのナビゲーションリンクでym引き継ぎ済みであることは
    // 他のテストケースで既に確認済み)。
    await page.goto("/cleansing?ym=2026-05");
    const link = page.getByRole("link", { name: "データ取込へ進む" });
    await expect(link).toHaveAttribute("href", "/import?ym=2026-05");
  });
});
