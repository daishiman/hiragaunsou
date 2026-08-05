import { defineConfig, devices } from "@playwright/test";

/**
 * 認証(Google OAuth)が必須の画面が大半のため、未ログイン時のリダイレクト/公開ページに加え、
 * ログイン後の画面は招待経由のメール/パスワード作成パス(本番コード非改変、tests/e2e/helpers/
 * 配下で完結)でセッションを発行して検証する(docs/testing-strategy.md参照)。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
