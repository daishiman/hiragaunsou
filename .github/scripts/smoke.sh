#!/usr/bin/env bash
# デプロイ直後の稼働確認。
#
# 1回だけ叩いても意味が薄い。Cloudflare Workers は旧バージョンの実行環境(isolate)を
# 数十秒〜1〜2分保持するため、デプロイ直後のレスポンスは古いコードのものが返り得る。
# その状態で緑になっても「新しいコードが動いている」証拠にはならないし、逆に
# 壊れている新コードを古い正常応答で覆い隠してしまう。
# だから「間隔を空けて2回」叩き、両方通ったときだけ成功とする。
#
# 使い方:
#   APP_ORIGIN=https://example.workers.dev bash .github/scripts/smoke.sh
set -euo pipefail

APP_ORIGIN="${APP_ORIGIN:?APP_ORIGIN が設定されていません}"

# 1回目までの待機と、1回目から2回目までの待機。
# 手元で試すときは FIRST_WAIT=0 SECOND_WAIT=0 で短縮できる。
FIRST_WAIT="${FIRST_WAIT:-30}"
SECOND_WAIT="${SECOND_WAIT:-90}"

# 認証なしで到達できる入口だけを対象にする。
# /api/me は未ログインでも応答を返す(その応答自体が壊れていないことを見る)。
PATHS=("/sign-in" "/api/me")

probe() {
  local label="$1"
  local failed=0

  for path in "${PATHS[@]}"; do
    local url="${APP_ORIGIN}${path}"
    local code
    # --retry は一時的なネットワーク断のためのもので、待機の代わりにはならない。
    # (リトライ間隔が短すぎて、古い isolate が入れ替わるのを待てないため)
    code="$(curl --silent --show-error --location \
                 --retry 3 --retry-all-errors --max-time 20 \
                 --output /dev/null --write-out '%{http_code}' \
                 "$url")" || code="000"

    if [ "$code" = "200" ]; then
      echo "  OK   ${path} (HTTP ${code})"
    else
      echo "  NG   ${path} (HTTP ${code})"
      failed=1
    fi
  done

  if [ "$failed" -ne 0 ]; then
    echo "::error::${label} のスモークテストが失敗しました (${APP_ORIGIN})"
    return 1
  fi
  echo "${label}: 通過"
}

echo "対象: ${APP_ORIGIN}"

echo "1回目まで ${FIRST_WAIT} 秒待機します..."
sleep "$FIRST_WAIT"
probe "1回目"

echo "2回目まで ${SECOND_WAIT} 秒待機します(旧バージョンの実行環境が入れ替わるのを待つ)..."
sleep "$SECOND_WAIT"
probe "2回目"

echo "スモークテストは2回とも通過しました。"
