import js from "@eslint/js";
import tseslint from "typescript-eslint";
import next from "eslint-config-next";

/**
 * ESLint 設定 (Flat Config)。
 *
 * 方針: 「壊れるもの」だけを error にし、様式の好みは持ち込まない。
 * 既存コードを大量に書き換えさせるルール (any禁止・命名規約など) は
 * 入れていない。lint が赤いまま放置される状態を作らないことを優先する。
 */
export default tseslint.config(
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "node_modules/**",
      "dist/**",
      "mock/**",
      "Product Excellence Kit/**",
      "worker-configuration.d.ts",
      "next-env.d.ts",
      "migrations/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,
  {
    rules: {
      // 未使用は警告に留める (_ 始まりは意図的な無視として許可)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // 外部データ (D1のJSON列・パーサの入力) の型付けは段階的に進める
      "@typescript-eslint/no-explicit-any": "warn",
      // Next.js の <Image> 強制は使っていないので無効化
      "@next/next/no-img-element": "off",
      // 全角スペース(　)は日本語UI・テスト期待値では正しい文字なので、
      // 文字列・テンプレート・JSXテキスト・コメント内は許可する。
      // インデント等のコード部分に紛れ込んだものだけを検出したい。
      "no-irregular-whitespace": [
        "error",
        { skipStrings: true, skipTemplates: true, skipComments: true, skipJSXText: true },
      ],
      // ファイル名のサニタイズで制御文字を意図的に対象にしている
      "no-control-regex": "off",
      // 型の拡張ポイントとして中身のない interface を使う (env.d.ts)
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    // テストは vitest のグローバル (describe/it/expect) を使う
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    languageOptions: {
      globals: { describe: "readonly", it: "readonly", expect: "readonly", vi: "readonly" },
    },
  },
);
