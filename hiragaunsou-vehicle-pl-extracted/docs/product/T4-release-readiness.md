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

## 送信時の記録・Claude Code への引き渡しの追加分 (2026-08-15)

- マイグレーションは3本。`0023_add_improvement_diagnostics.sql`（新しい表 `improvement_diagnostics`）、
  `0024_add_improvement_lifecycle.sql`（廃棄・重複のための列）、
  `0025_replace_github_issue_with_instruction.sql`（GitHub 用の列を落とし、`improvement_instruction` と
  `instruction_access_token` を追加）。既存の業務データの表・列は変えていないため埋め戻しは不要。
- **ここでも順番はマイグレーション → デプロイで固定する。** 逆にすると、新しいアプリが存在しない列を読んで本番が落ちる。
- 二重発行の防止は3段。①内容の指紋が同じなら実行しない ②60秒で切れる作業中の印（リース）
  ③`improvement_instruction.request_id` を**主キー**にして、1要望1指示文を DB 側で保証する。
  アプリの処理だけに頼らない（別タブ・再送で抜けるため）。
- **追加のシークレットは無い。** `wrangler.jsonc` の `secrets.required` は
  `BETTER_AUTH_SECRET` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` のまま。
  画面の写しの署名鍵は `BETTER_AUTH_SECRET` に用途名を混ぜて導く（設定を1つ増やすたびに、
  登録し忘れて本番だけ落ちる箇所が増えるため）。GitHub 連携で使っていた
  `GITHUB_ISSUE_TOKEN` / `GITHUB_ISSUE_REPO` / `GITHUB_ISSUE_ATTACH_SHOT` は不要になった。
  **登録済みの環境では `wrangler secret delete` で消すこと**（使われない鍵を残す理由が無い）。
- 指示文の取得（`/api/instructions`）は**ログイン Cookie ではなく鍵**で通る唯一の口。無認証では1件も読めない。
  鍵は「範囲つき（発行した件だけ）・期限つき（既定7日・最長30日）・いつでも失効できる」の3点で守る。
  平文は発行の応答1回きりで、保存するのは指紋（SHA-256）だけ。
- 画面の写しは自前の期限つき署名URL（24時間）で配る。画像を外のサービスへ置かない
  （置いた瞬間に、消す権限も期限もこちらの手を離れる）。署名が違う・期限切れ・画像が無いはすべて同じ 404 を返す。
- 集める量・保存する量・渡す量は別々に決めてある。指示文に出さないのは氏名・メール・実URL
  （`src/domain/rules/improvementInstruction.ts` の冒頭に列挙、`tests/domain/improvementInstruction.test.ts` で固定）。
  本文に混ざった値の形の秘密は `maskSensitive` を必ず通す。
- 黒塗りは元画像へ焼き込む（`app/_lib/annotate.ts`）。元画像は送信も保存もしない。
  焼き込み後のピクセルから元が取れないことは `tests/lib/annotate.test.ts` で固定している。
- 完全削除では、本文・写し・診断情報に加えて**発行済みの指示文とその件を読める鍵も無効化する**（記録は残す）。
- 元に戻す場合: 直前のタグへ戻せば発行の操作と記録の表示が消える。すでに配った鍵は
  `/admin/improvements/tokens` から止める（外部サービスには何も残らない）。
