import { test, expect } from "@playwright/test";

/**
 * ログイン必須画面のUXの土台(未ログイン時の振る舞い)を実ブラウザで検証する。
 * Google OAuthを伴う「ログイン後」の画面遷移は、本番と分離したテスト専用の認証手段を
 * 別途用意するまでE2E対象外(docs/testing-strategy.md参照)。
 */
test.describe("未ログイン時のアクセス制御", () => {
  test("ホームは未ログインだとサインイン画面へリダイレクトされる", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { name: "車両別収支表" })).toBeVisible();
  });

  test("保護されたページ(赤字の理由)も未ログインだとサインイン画面へリダイレクトされる", async ({
    page,
  }) => {
    await page.goto("/deficit");
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("マイページも未ログインだとサインイン画面へリダイレクトされる", async ({ page }) => {
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("利用者の管理画面も未ログインだとサインイン画面へリダイレクトされる", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("サインイン画面にはGoogleログインボタンが表示される", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("button", { name: /Google/ })).toBeVisible();
  });

  test("OAuthコールバック失敗時はエラーコードに応じた文言を表示する", async ({ page }) => {
    await page.goto("/sign-in?error=access_denied");
    await expect(page.getByText("Googleでのサインインがキャンセルされました。")).toBeVisible();
  });
});
