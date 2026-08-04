# T4 リリース判定 — 2026-08-03

## 実装・検証済み

- `typecheck`、全Vitest、Cloudflare型定義チェック、OpenNext本番ビルド、`wrangler deploy --dry-run` が通る。
- 共有された2種類の5月Excelから、51列の車両別収支表を抽出できる。
- D1のリモートマイグレーションは未適用なし。
- PR CIは型検査・テストに加え、Cloudflareビルドとproduction dependencyのHigh/Critical脆弱性検査を実行する。
- CDは競合防止、事前ビルド・dry-run、D1適用、デプロイ後のマイグレーション確認とHTTP smoke testを実行する。

## 本番リリース前の必須ブロッカー

1. `wrangler.jsonc` の `WORKSPACE_DOMAINS` を平賀運送の実Google Workspaceドメインへ変更する（複数ある場合はカンマ区切り）。
2. Google Cloud Consoleで本番OAuth Clientを作り、許可済みリダイレクトURIに `https://hiragaunsou-vehicle-pl.daishimanju.workers.dev/api/auth/callback/google`（独自ドメインを使う場合はそのURI）を登録する。
3. Cloudflare Worker Secretに `BETTER_AUTH_SECRET`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` を設定する。AI分析を有効化する場合は `ANTHROPIC_API_KEY` も設定する。
4. GitHub Environment `production` に `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、必要に応じて `HIRAGAUNSOU_APP_ORIGIN` を登録し、承認者を設定する。
5. GitHub mainのブランチ保護で、`hiragaunsou-vehicle-pl CI / typecheck + test` を必須チェックにする。

## 現在の判定

**コードはデプロイ可能、認証設定が未投入のため本番公開は保留。**

本番URLの `/sign-in` はHTTP 500であり、Worker Secret一覧が空であることを確認した。CDはプレースホルダーのドメインを検知してデプロイ前に停止するため、設定漏れのまま壊れた版を公開しない。
