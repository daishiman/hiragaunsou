#!/usr/bin/env sh
# 改善要望の指示文を取りに行く入口。
#
# 鍵をどう渡すかだけを決めて、あとは scripts/improvement.mjs に任せる。
#
# 既定は 1Password。`op run --` を使うのが肝心なところで、鍵は
# **この1回の実行のプロセスにだけ**環境変数として入る。シェルには残らない。
#   - export しない (次のコマンドに引き継がれない)
#   - echo しない、set -x もしない (画面にも履歴にも出ない)
#   - op 自身も出力に混じった鍵を伏せる (こちらの伏せ字と二重になる)
#
# 1Password が入っていない環境で詰まらないよう、環境変数の経路も残してある。
# どちらを使ったかは必ず画面に出す (思っていたのと違う鍵で動く状況を作らない)。
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(dirname -- "$SCRIPT_DIR")
ENV_FILE="${HGCC_ENV_FILE:-$APP_DIR/.env.improvement}"

if command -v op >/dev/null 2>&1 && [ -f "$ENV_FILE" ]; then
  # .env.improvement に書くのは op:// で始まる「置き場所の指し先」だけ。
  # 鍵の実物は 1Password の中にしかなく、このファイルはコミット対象から外してある。
  HGCC_SOURCE="1Password" exec op run --env-file="$ENV_FILE" -- \
    node "$SCRIPT_DIR/improvement.mjs" "$@"
fi

if [ -n "${HGCC_TOKEN:-}" ]; then
  echo "1Password を使わず、環境変数の鍵で動かします。" >&2
  HGCC_SOURCE="環境変数" exec node "$SCRIPT_DIR/improvement.mjs" "$@"
fi

cat >&2 <<'MSG'
鍵の置き場所が見つかりません。次のどちらかを用意してください。

  1. 1Password を使う（おすすめ）
     - 1Password CLI を入れる:  brew install 1password-cli
     - アプリのフォルダに .env.improvement を作り、次の1行だけ書く
         HGCC_TOKEN=op://<保管庫>/<項目>/credential
       ※ここに書くのは「置き場所の指し先」だけ。鍵の実物は書かない。

  2. 1Password を使わない
     - HGCC_TOKEN=<鍵> をこのコマンドの前に付けて実行する

鍵の作り方と失効のさせ方は docs/product/claude-code-improvement-guide.md にあります。
MSG
exit 1
