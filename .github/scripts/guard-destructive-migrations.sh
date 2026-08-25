#!/usr/bin/env bash
# 本番D1へ適用される「未適用マイグレーション」に、元に戻せない操作が含まれていないか検査する。
#
# なぜ必要か:
#   このリポジトリでは main へのマージで D1 マイグレーションが自動適用される。
#   コードのデプロイは wrangler rollback で戻せるが、DBの構造変更は戻せない。
#   列を消せば中身も消える。だから「適用される直前に機械が止める」層をここに置く。
#
# 何を検査しないか:
#   適用済みのマイグレーションは見ない。過去に適用された 0005_drop_raw_ingestion_batch_idx.sql が
#   毎回ヒットして、デプロイが恒久的に止まってしまうため。
#
# 使い方:
#   bash .github/scripts/guard-destructive-migrations.sh <D1データベース名> [マイグレーションディレクトリ]
#
# 意図的に破壊的変更を適用したいときは、環境変数 ALLOW_DESTRUCTIVE_MIGRATION=YES を付けて
# ワークフローを手動起動する(理由をPRかコミットに残すこと)。
set -euo pipefail

DB_NAME="${1:?第1引数に D1 データベース名を指定してください}"
MIGRATIONS_DIR="${2:-migrations}"
ALLOW_DESTRUCTIVE_MIGRATION="${ALLOW_DESTRUCTIVE_MIGRATION:-}"

# --- 未適用マイグレーションの特定 -------------------------------------------
# `wrangler d1 migrations list` は「まだ適用されていないもの」を出力する。
if ! list_output="$(pnpm exec wrangler d1 migrations list "$DB_NAME" --remote 2>&1)"; then
  echo "::error::未適用マイグレーションの一覧を取得できませんでした"
  printf '%s\n' "$list_output"
  exit 1
fi

# wrangler の表示形式(表・箇条書き)はバージョンで変わる。
# 形式に依存しないよう、ファイル名のパターンだけを拾う。
pending="$(printf '%s\n' "$list_output" | grep -oE '[0-9]{4}_[A-Za-z0-9_]+\.sql' | sort -u || true)"

if [ -z "$pending" ]; then
  echo "未適用のマイグレーションはありません。検査をスキップします。"
  exit 0
fi

echo "未適用のマイグレーション:"
printf '  - %s\n' $pending
echo ""

# --- 破壊的操作の判定 --------------------------------------------------------
# 引数: SQLファイルのパス
# 戻り値: 0 = 破壊的(止めるべき) / 1 = 安全(通してよい)
# 破壊的と判定した理由は標準出力に1行で出すこと(ログだけを見て判断できるようにするため)。
is_destructive() {
  local sql_file="$1"
  local sql

  # 先にSQLコメントを落とす。drizzle は文の区切りに `--> statement-breakpoint` を挟み、
  # 人が書いた注記にも「この列は将来 drop する」のような文言が入り得るため、
  # コメントを残したまま文字列一致すると本文でない箇所で誤爆する。
  sql="$(sed -e 's/--.*$//' "$sql_file")"

  local reason=""

  # DROP INDEX / DROP TRIGGER / DROP VIEW は対象外にする。
  # これらは定義を捨てるだけで行データは失われず、作り直せる。
  # 実際 0005_drop_raw_ingestion_batch_idx.sql は本番に適用済みで、
  # ここで拾うとデプロイが恒久的に止まる。
  if printf '%s' "$sql" | grep -qiE 'DROP[[:space:]]+TABLE'; then
    reason="DROP TABLE (テーブルごと消える)"
  elif printf '%s' "$sql" | grep -qiE 'DROP[[:space:]]+COLUMN'; then
    reason="DROP COLUMN (列の中身が消える)"
  elif printf '%s' "$sql" | grep -qiE 'DELETE[[:space:]]+FROM'; then
    reason="DELETE FROM (行が消える)"
  elif printf '%s' "$sql" | grep -qiE '\bTRUNCATE\b'; then
    reason="TRUNCATE (全行が消える)"
  elif printf '%s' "$sql" | grep -qiE 'RENAME[[:space:]]+(TO|COLUMN)'; then
    reason="RENAME (旧名を参照している既存コードが壊れる)"
  fi

  if [ -z "$reason" ]; then
    return 1
  fi

  echo "  検出: ${reason}"

  # drizzle は列の削除や型変更で「新テーブル作成 → データ移送 → 旧テーブルDROP → RENAME」
  # という再作成パターンを出すことがある。これはデータ保持を意図した操作だが、
  # 移送する列が網羅されているかは機械には判断できない(1列書き忘れれば黙って消える)。
  # よって通さず、人間が見るべき観点だけを添えて止める。
  if printf '%s' "$sql" | grep -qiE 'INSERT[[:space:]]+INTO'; then
    echo "       テーブル再作成パターンの可能性があります。"
    echo "       移送先の INSERT に全ての列が含まれているかを目視で確認してください。"
  fi

  return 0
}

# --- 検査の実行 --------------------------------------------------------------
blocked=0
for name in $pending; do
  path="${MIGRATIONS_DIR}/${name}"

  if [ ! -f "$path" ]; then
    echo "::error::${path} が見つかりません。本番に未適用の記録があるのにファイルが無い状態です。"
    exit 1
  fi

  if is_destructive "$path"; then
    echo "::error::${name} に元に戻せない操作が含まれています。"
    blocked=1
  else
    echo "  OK   ${name}"
  fi
done

if [ "$blocked" -eq 0 ]; then
  echo ""
  echo "破壊的な操作は見つかりませんでした。適用に進みます。"
  exit 0
fi

if [ "$ALLOW_DESTRUCTIVE_MIGRATION" = "YES" ]; then
  echo ""
  echo "::warning::ALLOW_DESTRUCTIVE_MIGRATION=YES が指定されたため、破壊的変更を承認済みとして続行します。"
  exit 0
fi

cat <<'MSG'

===============================================================
 本番DBに対して元に戻せない変更が行われようとしたため停止しました。
===============================================================

続行するには、内容を確認したうえで次のいずれかを行ってください。

  1. マイグレーションを非破壊的な形に書き直す
     (列の削除は2段階に分ける: 先に新コードを出して旧列を誰も読まない状態にし、
      その後で削除だけのマイグレーションを適用する)

  2. 意図した破壊的変更である場合は、Actions からこのワークフローを手動起動し、
     allow_destructive_migration に YES を入力する
     (実行前に本番データのバックアップを取ること)

MSG
exit 1
