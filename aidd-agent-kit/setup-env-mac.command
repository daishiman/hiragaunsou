#!/bin/bash
# =====================================================
#  開発環境セットアップ (Mac用)
#  Node.js と pnpm をインストールし、Claude Code / Codex と
#  Cloudflare の連携(MCP)も設定します
#  ダブルクリックするだけでOKです
#  v1.10.2
# =====================================================

finish() {
  echo ""
  read -r -p "Enterキーを押すとこのウィンドウを閉じられます..." || true
  exit "${1:-0}"
}

trap 'echo ""; echo "[エラー] 予期しない問題が発生したため中断しました。"; echo "この画面のまま導入支援の担当者にお見せください。"; finish 1' ERR
set -e

echo ""
echo "==============================================="
echo "  開発環境セットアップ (Mac)"
echo "  Node.js と pnpm を準備します"
echo "==============================================="
echo ""

# --- ステップ 1/4: pnpm のインストール -------------------------
export PNPM_HOME="$HOME/Library/pnpm"
export PATH="$PNPM_HOME:$PATH"

PNPM_VERSION=""
if command -v pnpm >/dev/null 2>&1; then
  if ! PNPM_VERSION=$(pnpm --version 2>/dev/null) || [ -z "${PNPM_VERSION//[[:space:]]/}" ]; then
    echo "[エラー] pnpm コマンドは見つかりましたが、正常に実行できません。"
    echo "pnpm のインストールを修復してから、もう一度実行してください。"
    finish 1
  fi
  echo "(1/4) pnpm はインストール済みです ($PNPM_VERSION)"
else
  echo "(1/4) pnpm をインストールしています(1〜2分)..."
  curl -fsSL https://get.pnpm.io/install.sh | sh -
  export PATH="$PNPM_HOME:$PATH"
  PNPM_VERSION=""
  if ! command -v pnpm >/dev/null 2>&1 ||
     ! PNPM_VERSION=$(pnpm --version 2>/dev/null) ||
     [ -z "${PNPM_VERSION//[[:space:]]/}" ]; then
    echo "[エラー] pnpm のインストールに失敗しました。"
    echo "インターネット接続を確認して、もう一度実行してください。"
    echo "社内ネットワークの通信制限が原因の場合があります。"
    echo "解決しないときは、この画面のままIT担当者にお見せください。"
    finish 1
  fi
  echo "      pnpm $PNPM_VERSION をインストールしました"
fi

# --- ステップ 2/4: Node.js のインストール ----------------------
echo "(2/4) Node.js を確認しています..."
NODE_VERSION=""
if command -v node >/dev/null 2>&1; then
  if ! NODE_VERSION=$(node --version 2>/dev/null) || [ -z "${NODE_VERSION//[[:space:]]/}" ]; then
    echo "[エラー] Node.js コマンドは見つかりましたが、正常に実行できません。"
    echo "Node.js のインストールを修復してから、もう一度実行してください。"
    finish 1
  fi
  echo "      Node.js はインストール済みです ($NODE_VERSION)"
else
  echo "      Node.js をインストールしています(2〜3分)..."
  pnpm env use --global lts
  export PATH="$PNPM_HOME:$PATH"
  NODE_VERSION=""
  if ! command -v node >/dev/null 2>&1 ||
     ! NODE_VERSION=$(node --version 2>/dev/null) ||
     [ -z "${NODE_VERSION//[[:space:]]/}" ]; then
    echo "[エラー] Node.js のインストールに失敗しました。"
    echo "この画面のまま導入支援の担当者にお見せください。"
    finish 1
  fi
  echo "      Node.js $NODE_VERSION をインストールしました"
fi

# --- ステップ 3/4: AI開発ツールと Cloudflare の連携(MCP) ---------
echo "(3/4) Claude Code / Codex と Cloudflare の連携を設定しています..."

MCP_FAILURES=0
MCP_PENDING=0
CLAUDE_MCP_PENDING=0
CODEX_MCP_PENDING=0
CODEX_PENDING_SERVERS=""

report_claude_mcp_status() {
  server_name="$1"
  server_url="$2"
  status_output="$3"
  action="$4"

  if ! printf '%s\n' "$status_output" | grep -Fq "Scope: User config" ||
     ! printf '%s\n' "$status_output" | grep -Fq "Type: http" ||
     ! printf '%s\n' "$status_output" | grep -Fq "URL: $server_url"; then
    return 1
  fi

  if printf '%s\n' "$status_output" | grep -Eq 'Status:.*Connected'; then
    echo "      Claude Code / $server_name: $action(接続ready)"
    return 0
  fi

  if printf '%s\n' "$status_output" | grep -Eiq 'Status:.*(Needs authentication|Authentication required|Needs auth)'; then
    echo "      Claude Code / $server_name: 設定済み・認証待ち"
    MCP_PENDING=$((MCP_PENDING + 1))
    CLAUDE_MCP_PENDING=1
    return 0
  fi

  echo "      Claude Code / $server_name: 失敗(接続状態がreadyではありません)"
  printf '%s\n' "$status_output"
  MCP_FAILURES=$((MCP_FAILURES + 1))
  return 0
}

configure_claude_mcp() {
  server_name="$1"
  server_url="$2"
  existing=""

  if existing=$(claude mcp get "$server_name" 2>&1); then
    if printf '%s\n' "$existing" | grep -Fq "Scope: User config" &&
       printf '%s\n' "$existing" | grep -Fq "Type: http" &&
       printf '%s\n' "$existing" | grep -Fq "URL: $server_url"; then
      report_claude_mcp_status "$server_name" "$server_url" "$existing" "スキップ"
      return
    fi

    echo "      Claude Code / $server_name: 古い設定を更新します"
    if ! claude mcp remove "$server_name"; then
      echo "      Claude Code / $server_name: 失敗(古い設定を削除できませんでした)"
      MCP_FAILURES=$((MCP_FAILURES + 1))
      return
    fi
  elif ! printf '%s\n' "$existing" | grep -Eq 'No MCP server (named|found with name)'; then
    echo "      Claude Code / $server_name: 失敗(現在の設定を確認できませんでした)"
    printf '%s\n' "$existing"
    MCP_FAILURES=$((MCP_FAILURES + 1))
    return
  fi

  add_status=0
  claude mcp add --transport http --scope user "$server_name" "$server_url" || add_status=$?

  existing=""
  if existing=$(claude mcp get "$server_name" 2>&1) &&
     report_claude_mcp_status "$server_name" "$server_url" "$existing" "成功"; then
    if [ "$add_status" -ne 0 ]; then
      echo "      Claude Code / $server_name: 失敗(CLI終了コード $add_status)"
      MCP_FAILURES=$((MCP_FAILURES + 1))
    fi
  else
    echo "      Claude Code / $server_name: 失敗(設定後の確認NG、CLI終了コード $add_status)"
    printf '%s\n' "$existing"
    MCP_FAILURES=$((MCP_FAILURES + 1))
  fi
}

get_codex_auth_status() {
  server_name="$1"
  list_output=""
  auth_status=""

  if ! list_output=$(codex mcp list --json 2>&1); then
    printf '%s\n' "$list_output"
    return 1
  fi

  if ! auth_status=$(printf '%s\n' "$list_output" | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", () => {
      const server = JSON.parse(input).find(item => item.name === process.argv[1]);
      if (!server || typeof server.auth_status !== "string") process.exit(2);
      process.stdout.write(server.auth_status);
    });
  ' "$server_name" 2>/dev/null); then
    return 1
  fi

  printf '%s' "$auth_status"
}

report_codex_mcp_status() {
  server_name="$1"
  auth_status=""

  if ! auth_status=$(get_codex_auth_status "$server_name"); then
    echo "      OpenAI Codex / $server_name: 失敗(認証状態を確認できませんでした)"
    MCP_FAILURES=$((MCP_FAILURES + 1))
    return
  fi

  case "$auth_status" in
    o_auth|bearer_token)
      echo "      OpenAI Codex / $server_name: 設定済み・認証済み(接続ready)"
      ;;
    unsupported)
      echo "      OpenAI Codex / $server_name: 設定済み・認証不要(接続ready)"
      ;;
    not_logged_in)
      echo "      OpenAI Codex / $server_name: 設定済み・認証待ち"
      MCP_PENDING=$((MCP_PENDING + 1))
      CODEX_MCP_PENDING=1
      CODEX_PENDING_SERVERS="$CODEX_PENDING_SERVERS $server_name"
      ;;
    *)
      echo "      OpenAI Codex / $server_name: 失敗(未確認の認証状態: $auth_status)"
      MCP_FAILURES=$((MCP_FAILURES + 1))
      ;;
  esac
}

run_codex_mcp_add() {
  server_name="$1"
  server_url="$2"
  add_status=0
  # Codex CLI はOAuth対応サーバーを検出すると、このコマンド内で
  # ブラウザ認証を案内して完了を待つ。出力を隠さず利用者に提示する。
  codex mcp add "$server_name" --url "$server_url" || add_status=$?
  CODEX_ADD_STATUS=$add_status
}

configure_codex_mcp() {
  server_name="$1"
  server_url="$2"
  existing=""

  if existing=$(codex mcp get "$server_name" --json 2>&1); then
    if printf '%s\n' "$existing" | grep -Fq 'streamable_http' &&
       printf '%s\n' "$existing" | grep -Fq "$server_url"; then
      report_codex_mcp_status "$server_name"
      return
    fi

    echo "      OpenAI Codex / $server_name: 古い設定を更新します"
    if ! codex mcp remove "$server_name"; then
      echo "      OpenAI Codex / $server_name: 失敗(古い設定を削除できませんでした)"
      MCP_FAILURES=$((MCP_FAILURES + 1))
      return
    fi
  elif ! printf '%s\n' "$existing" | grep -Eq 'No MCP server (named|found with name)'; then
    echo "      OpenAI Codex / $server_name: 失敗(現在の設定を確認できませんでした)"
    printf '%s\n' "$existing"
    MCP_FAILURES=$((MCP_FAILURES + 1))
    return
  fi

  CODEX_ADD_STATUS=0
  run_codex_mcp_add "$server_name" "$server_url"

  existing=""
  if existing=$(codex mcp get "$server_name" --json 2>&1) &&
     printf '%s\n' "$existing" | grep -Fq 'streamable_http' &&
     printf '%s\n' "$existing" | grep -Fq "$server_url"; then
    report_codex_mcp_status "$server_name"
  else
    echo "      OpenAI Codex / $server_name: 失敗(設定後の確認NG、CLI終了コード $CODEX_ADD_STATUS)"
    printf '%s\n' "$existing"
    MCP_FAILURES=$((MCP_FAILURES + 1))
  fi
}

if command -v claude >/dev/null 2>&1; then
  configure_claude_mcp cloudflare-bindings https://bindings.mcp.cloudflare.com/mcp
  configure_claude_mcp cloudflare-docs https://docs.mcp.cloudflare.com/mcp
else
  echo "      Claude Code: スキップ(コマンドが見つかりません)"
fi

if command -v codex >/dev/null 2>&1; then
  configure_codex_mcp cloudflare-bindings https://bindings.mcp.cloudflare.com/mcp
  configure_codex_mcp cloudflare-docs https://docs.mcp.cloudflare.com/mcp
else
  echo "      OpenAI Codex: スキップ(コマンドが見つかりません)"
fi
echo "      (認証待ちの項目は、下に表示する手順で認証してください)"

# --- ステップ 4/4: 確認 ---------------------------------------
echo "(4/4) 動作確認をしています..."
echo ""
echo "  Node.js: $NODE_VERSION"
echo "  pnpm:    $PNPM_VERSION"
echo ""
if [ "$MCP_FAILURES" -gt 0 ]; then
  echo "[エラー] Cloudflare MCP の設定または確認に $MCP_FAILURES 件失敗しました。"
  echo "上の失敗内容を確認してから、もう一度実行してください。"
  finish 1
fi
if [ "$MCP_PENDING" -gt 0 ]; then
  echo "==============================================="
  echo "  基本セットアップ完了 / Cloudflare MCP は認証待ち"
  echo "==============================================="
  echo ""
  echo "次に認証してください:"
  if [ "$CLAUDE_MCP_PENDING" -eq 1 ]; then
    echo "  Claude Code: Claude Code を開き、/mcp から認証待ちの項目を認証"
  fi
  if [ "$CODEX_MCP_PENDING" -eq 1 ]; then
    echo "  OpenAI Codex: ターミナルで次を順に実行"
    for server_name in $CODEX_PENDING_SERVERS; do
      echo "    codex mcp login $server_name"
    done
  fi
  echo "  認証後、このセットアップを再実行すると接続readyを確認できます。"
  finish 0
fi
echo "==============================================="
echo "  セットアップが完全に完了しました！"
echo "==============================================="
echo ""
echo "次にやること:"
echo "  開いているターミナルがあれば、一度閉じて開き直してください。"
echo "  (新しい設定を読み込むためです)"
finish 0
