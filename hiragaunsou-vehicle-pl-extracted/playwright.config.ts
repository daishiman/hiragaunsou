import { defineConfig, devices } from "@playwright/test";

/**
 * 認証(Google OAuth)が必須の画面が大半のため、E2Eは現時点では
 * 「未ログイン時のリダイレクト/公開ページ」というUXの土台部分に限定している。
 * ログイン後の画面遷移まで含めるには、本番と分離したテスト専用の認証バイパスを
 * 別途設計・合意した上で追加する必要がある(docs/testing-strategy.md参照)。
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
