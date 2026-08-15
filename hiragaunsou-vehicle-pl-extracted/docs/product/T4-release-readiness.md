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

## 送信時の記録・GitHub Issue 起票の追加分 (2026-08-15)

- マイグレーションは `0023_add_improvement_diagnostics.sql` の1本。新しい表 `improvement_diagnostics` と、
  `improvement_request` への列追加（`github_issue_number` / `github_issue_url` / `github_issued_at` /
  `github_issued_by_id` / `github_issuing_at`）のみ。既存の列は変えていないため埋め戻しは不要。
- **ここでも順番はマイグレーション → デプロイで固定する。** 逆にすると、新しいアプリが存在しない列を読んで本番が落ちる。
- 二重起票の防止は `github_issuing_at`（作業中の印、60秒で自然に切れる）と、
  `github_issue_number` の一意索引の2段で行う。番号は GitHub に投げた後にしか分からないため、
  「確認 → 起票 → 保存」だけでは同時押しを防げない。
- `GITHUB_ISSUE_TOKEN` / `GITHUB_ISSUE_REPO` は**任意**。`wrangler.jsonc` の `secrets.required` には入れていない。
  未設定でもデプロイは通り、「Issueにする」だけが理由つきで断られる。
- 権限は起票先リポジトリの Issues: Read and write のみ（fine-grained token）。コード・リポジトリには置かず、
  `wrangler secret put GITHUB_ISSUE_TOKEN` で登録する。取得先URL・必要権限・期限切れの注意・classic tokenの代替は
  README、`docs/setup-guide-remaining-tasks.md` タスク8、管理画面の案内（`GitHubTokenGuide`）の3か所に同じ内容で書いてある。
- 画面の写しをIssueへ貼るのは `GITHUB_ISSUE_ATTACH_SHOT=true` のときだけ（既定は貼らない）。
  貼るにはトークンに Contents: Read and write も要るため、既定を「貼らない」にして最小権限のまま使えるようにしてある。
  貼らない場合もIssueには管理画面の該当詳細ページへのリンクが必ず載る。
- 集める量・保存する量・外へ出す量は別々に決めてある。Issueに出さないものは
  氏名・メール・会社名・実URL・レスポンス本文・console全件（`src/domain/rules/improvementIssue.ts` の冒頭に列挙、テストで固定）。
- 黒塗りは元画像へ焼き込む（`app/_lib/annotate.ts`）。元画像は送信も保存もしない。
  焼き込み後のピクセルから元が取れないことは `tests/lib/annotate.test.ts` で固定している。
- 元に戻す場合: 直前のタグへ戻せば起票の操作と記録の表示が消える。既に立った Issue は GitHub 側に残る
  （こちらから消さない。手で閉じる）。
