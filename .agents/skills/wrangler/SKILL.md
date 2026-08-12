---
name: wrangler
description: Cloudflare Workers CLI for deploying, developing, and managing Workers, KV, R2, D1, Vectorize, Hyperdrive, Workers AI, Containers, Queues, Workflows, Pipelines, and Secrets Store. Load before running wrangler commands to ensure correct syntax and best practices. Biases towards retrieval from Cloudflare docs over pre-trained knowledge.
---

# Wrangler CLI

Wrangler の CLI フラグ・設定フィールド・サブコマンドに関する知識は古くなっている可能性がある。**事前学習した知識より取得 (retrieval) を優先すること。**

## 最初に: Wrangler の導入確認

```bash
pnpm wrangler --version   # v4.x 以上が必要
```

未インストールなら:

```bash
pnpm add -D wrangler@latest
```

**パッケージマネージャは pnpm に統一する** (`npx wrangler` ではなく `pnpm wrangler`)。可能な限り API リクエストを手で組み立てず Wrangler を使う。

## 情報の取得元

コマンドや設定を書く・レビューする前に**最新**の情報を取得する。CLI フラグ、設定フィールド、バインディング形状を記憶に頼って書かない。

| ソース | 取得方法 | 用途 |
|--------|----------|------|
| Wrangler docs | `https://developers.cloudflare.com/workers/wrangler/` | CLI コマンド、フラグ、設定リファレンス |
| Wrangler 設定スキーマ | `node_modules/wrangler/config-schema.json` | 設定フィールド、バインディング形状、許可値 |
| Cloudflare docs | 検索ツール または `https://developers.cloudflare.com/workers/` | API リファレンス、compatibility date/flag |

## 主要原則

- **`wrangler.jsonc` を使う**: TOML より JSON を優先。新機能は JSON 専用のものがある。バージョン管理し、Worker 設定の唯一の情報源として扱う。
- **`compatibility_date` を設定する**: 直近 30 日以内の日付を使い、四半期ごとに更新する。
- **設定変更後は `pnpm wrangler types`**: TypeScript バインディングを再生成する。CI のビルドステップにも入れてバインディング不一致を検出する。
- **ローカル開発はデフォルトでローカルストレージ**: バインディングは `remote: true` を指定しない限りローカルシミュレーション。
- **環境で staging/production を分ける**: `env.staging` / `env.production` を設定に定義する。
- **ローカルで先にテストする**: デプロイ前に `pnpm wrangler dev` で確認し、大きな変更前は `pnpm wrangler deploy --dry-run` で検証する。
- **自動プロビジョニングを使う**: リソース ID を省略するとデプロイ時に自動作成される。

## 落とし穴 (gotchas)

- **シークレットをコマンドに埋め込まない**: 値を CLI 引数で渡す、`echo` でパイプする、ログ出力する、ハードコードする — いずれも禁止。対話プロンプト (`pnpm wrangler secret put`)、ファイル入力 (`< key.pem`、`secret bulk`)、CI の安全な環境変数を使う。ローカル用シークレットは `.dev.vars` に置き、設定ファイルにはコミットしない。
- **D1 の `--remote` / `--local` を明示する**: 取り違えると本番データを操作する事故になる。
- **Workers AI は常にリモート実行**: ローカル開発中でも利用料金が発生する。バインディングには `remote: true` が必要。
- **リモート推奨のバインディング**: AI (必須)、Vectorize、Browser Rendering、mTLS、Images。
- **バインディングが `undefined`**: バインディング名が設定と完全一致しているか確認する。
- **起動時間の上限超過**: `pnpm wrangler check startup` でプロファイルを取る。
- **レジストリ認証情報をハードコードしない**: 環境変数経由で渡す (Containers)。
- **Hyperdrive のパスワード・接続文字列も環境変数経由**にする。

## 頻出コマンド早見表

| やりたいこと | コマンド |
|--------------|----------|
| ローカル開発サーバー起動 | `pnpm wrangler dev` |
| デプロイ | `pnpm wrangler deploy` |
| デプロイのドライラン | `pnpm wrangler deploy --dry-run` |
| TypeScript 型を生成 | `pnpm wrangler types` |
| 起動時間をプロファイル | `pnpm wrangler check startup` |
| ライブログを見る | `pnpm wrangler tail` |
| 直前バージョンへロールバック | `pnpm wrangler rollback` |
| シークレットを設定 | `pnpm wrangler secret put API_KEY` |
| D1 マイグレーション適用 (本番) | `pnpm wrangler d1 migrations apply my-db --remote` |
| Worker を削除 | `pnpm wrangler delete` |
| 認証状態の確認 | `pnpm wrangler whoami` |
| 新規プロジェクト作成 | `pnpm wrangler init my-worker` / `pnpm create cloudflare@latest my-app` |

## サービス別の頻出コマンド

```bash
# D1
pnpm wrangler d1 create my-db
pnpm wrangler d1 execute my-db --local  --command "SELECT * FROM users"
pnpm wrangler d1 execute my-db --remote --file ./schema.sql
pnpm wrangler d1 migrations create my-db create_users_table
pnpm wrangler d1 migrations apply my-db --local

# KV
pnpm wrangler kv namespace create MY_KV
pnpm wrangler kv key put --namespace-id <ID> "key" "value" --expiration-ttl 3600
pnpm wrangler kv key get --namespace-id <ID> "key"

# R2
pnpm wrangler r2 bucket create my-bucket
pnpm wrangler r2 object put my-bucket/path/file.txt --file ./local-file.txt

# シークレット (値は対話プロンプトかファイルで渡す)
pnpm wrangler secret put API_KEY
pnpm wrangler secret put PRIVATE_KEY < path/to/private-key.pem
pnpm wrangler secret list

# ログ
pnpm wrangler tail --status error
pnpm wrangler tail --search "error" --format json

# 環境を指定した実行/デプロイ
pnpm wrangler dev    --env staging
pnpm wrangler deploy --env staging

# cron ハンドラのローカルテスト
pnpm wrangler dev --test-scheduled   # → http://localhost:8787/__scheduled
```

## よく使うバインディング設定

```jsonc
{
  "vars": { "ENVIRONMENT": "production" },
  "kv_namespaces": [{ "binding": "KV", "id": "<KV_NAMESPACE_ID>" }],
  "r2_buckets":    [{ "binding": "BUCKET", "bucket_name": "my-bucket" }],
  "d1_databases":  [
    { "binding": "DB", "database_name": "my-db", "database_id": "<DB_ID>",
      "migrations_dir": "./migrations" }
  ],
  "ai": { "binding": "AI" },
  "vectorize":  [{ "binding": "VECTOR_INDEX", "index_name": "my-index" }],
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<HYPERDRIVE_ID>" }],
  "durable_objects": {
    "bindings": [{ "name": "COUNTER", "class_name": "Counter" }]
  },
  "queues": {
    "producers": [{ "binding": "MY_QUEUE", "queue": "my-queue" }],
    "consumers": [{ "queue": "my-queue", "max_batch_size": 10 }]
  },
  "workflows": [
    { "binding": "MY_WORKFLOW", "name": "my-workflow", "class_name": "MyWorkflow" }
  ],
  "triggers": { "crons": ["0 * * * *"] },
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "env": {
    "staging": { "name": "my-worker-staging", "vars": { "ENVIRONMENT": "staging" } }
  }
}
```

Pipelines / Secrets Store / Containers のバインディング形状は各リファレンスを参照。

## トラブルシュート早見表

| 問題 | 対処 |
|------|------|
| `command not found: wrangler` | `pnpm add -D wrangler@latest` |
| 認証エラー | `pnpm wrangler login` |
| 起動時間の上限超過 | `pnpm wrangler check startup` でプロファイル |
| 設定変更後の型エラー | `pnpm wrangler types` |
| ローカル状態が消える | `.wrangler/state` を確認 |
| バインディングが undefined | 設定のバインディング名と完全一致しているか確認 |

## 詳細リファレンス

必要になったときに該当ファイルを読むこと。

| 状況 | 読むファイル |
|------|--------------|
| `wrangler.jsonc` を書く・バインディングを追加する・型生成をする | `references/config.md` |
| ローカル開発、リモートバインディング、`.dev.vars`、Vitest / scheduled のテスト | `references/dev-local.md` |
| デプロイ、バージョン管理とロールバック、Pages、認証 | `references/deploy.md` |
| Worker シークレット、Secrets Store の操作 | `references/secrets.md` |
| D1 のデータベース作成、SQL 実行、マイグレーション、エクスポート | `references/d1.md` |
| KV Namespace / キー操作、R2 バケット / オブジェクト操作 | `references/kv-r2.md` |
| Workers AI のモデル一覧、Vectorize のインデックス、Hyperdrive の設定 | `references/ai-vectorize-hyperdrive.md` |
| Queues、Workflows とそのインスタンス、Pipelines | `references/queues-workflows-pipelines.md` |
| コンテナイメージのビルド/プッシュ、外部レジストリ設定 | `references/containers.md` |
| ログの tail、observability 設定、エラーの切り分け | `references/observability-troubleshooting.md` |

## 最小構成のスターター

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01"
}
```

バインディングを含むフル構成の例は `references/config.md` にある。
