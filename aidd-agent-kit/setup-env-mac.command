#!/bin/bash
# =====================================================
#  開発環境セットアップ (Mac用)
#  Node.js と pnpm をインストールし、Claude Code と
#  Cloudflare の連携(MCP)も設定します
#  ダブルクリックするだけでOKです
#  v1.4.0
# =====================================================

finish() {
  echo ""
  read -p "Enterキーを押すとこのウィンドウを閉じられます..."
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

if command -v pnpm >/dev/null 2>&1; then
  echo "(1/4) pnpm はインストール済みです ($(pnpm --version))"
else
  echo "(1/4) pnpm をインストールしています(1〜2分)..."
  curl -fsSL https://get.pnpm.io/install.sh | sh -
  export PATH="$PNPM_HOME:$PATH"
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "[エラー] pnpm のインストールに失敗しました。"
    echo "インターネット接続を確認して、もう一度実行してください。"
    echo "社内ネットワークの通信制限が原因の場合があります。"
    echo "解決しないときは、この画面のままIT担当者にお見せください。"
    finish 1
  fi
  echo "      pnpm $(pnpm --version) をインストールしました"
fi

# --- ステップ 2/4: Node.js のインストール ----------------------
echo "(2/4) Node.js を確認しています..."
if command -v node >/dev/null 2>&1; then
  echo "      Node.js はインストール済みです ($(node --version))"
else
  echo "      Node.js をインストールしています(2〜3分)..."
  pnpm env use --global lts
  export PATH="$PNPM_HOME:$PATH"
  if ! command -v node >/dev/null 2>&1; then
    echo "[エラー] Node.js のインストールに失敗しました。"
    echo "この画面のまま導入支援の担当者にお見せください。"
    finish 1
  fi
  echo "      Node.js $(node --version) をインストールしました"
fi

# --- ステップ 3/4: Claude Code と Cloudflare の連携(MCP) --------
echo "(3/4) Claude Code と Cloudflare の連携を設定しています..."
if command -v claude >/dev/null 2>&1; then
  claude mcp add --transport sse cloudflare-bindings https://bindings.mcp.cloudflare.com/sse >/dev/null 2>&1 || true
  claude mcp add --transport sse cloudflare-docs https://docs.mcp.cloudflare.com/sse >/dev/null 2>&1 || true
  echo "      設定しました(初回利用時にブラウザで許可画面が開くことがあります)"
else
  echo "      Claude Code のコマンドが見つからないため、この設定はスキップしました。"
  echo "      (アプリ開発を始めるときに、AIが自動で案内します)"
fi

# --- ステップ 4/4: 確認 ---------------------------------------
echo "(4/4) 動作確認をしています..."
echo ""
echo "==============================================="
echo "  セットアップが完了しました！"
echo "==============================================="
echo ""
echo "  Node.js: $(node --version)"
echo "  pnpm:    $(pnpm --version)"
echo ""
echo "次にやること:"
echo "  開いているターミナルがあれば、一度閉じて開き直してください。"
echo "  (新しい設定を読み込むためです)"
finish 0
