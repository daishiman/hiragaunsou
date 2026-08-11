import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * デフォルトはNode環境(ドメイン/ユースケース/APIルート向け)。
 * UIコンポーネントのテストファイル先頭に `/** @vitest-environment jsdom *\/` を書くと
 * そのファイルだけjsdomで実行される(Vitest v4の環境切り替え方式)。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["./tests/setup/testingLibrary.ts"],
    globals: true,
    // 既定5sは jsdom + 高負荷(Rosetta等)で初回描画が落ちることがある。
    // 契約自体は軽いので上限だけ広げる（無限待ちにはしない）。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: [
        "src/domain/**",
        "src/usecase/**",
        "src/infrastructure/**",
        "app/api/**/route.ts",
        "app/_components/**/*.tsx",
        "app/_lib/**",
        "app/(app)/**/*.tsx",
        "middleware.ts",
      ],
      exclude: [
        "src/infrastructure/db/schema.ts",
        "src/infrastructure/db/auth-schema.ts",
        "src/infrastructure/db/client.ts",
        "**/*.d.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
