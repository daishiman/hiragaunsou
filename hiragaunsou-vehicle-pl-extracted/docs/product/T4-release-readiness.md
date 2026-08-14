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

## 改善要望機能の追加分 (2026-08-15)

- 追加したのは新しい表2つ（`improvement_request` / `improvement_shot`）だけで、既存の表・列は変えていない。
  既存データの入れ替えも移し替えも無いため、埋め戻し（backfill）は不要。
- **反映の順番はマイグレーション → デプロイで固定する。** 逆にすると、新しいアプリが存在しない表を読んで本番が落ちる。
  CDを使う場合は、マージの前に `migrate.yml` を手動実行する。
- 画像は D1 に本文と同じ1回の `batch` で書く。1件あたりの上限は 700KB（送信全体は 960KB）で、
  ブラウザ側で縮小・圧縮してから送るため、通常の画面1枚は 100〜300KB に収まる。
- 元に戻す場合: アプリを直前のタグへ戻せば、要望の投稿口と管理画面は消える。追加した表は残るが、
  他の機能は一切参照していないため実害は無い（消す必要が出たときだけ、別のマイグレーションで落とす）。
