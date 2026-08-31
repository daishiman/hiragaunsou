#!/bin/bash
# =====================================================
#  開発環境セットアップ (Mac用)
#  Node.js と pnpm をインストールし、Claude Code / Codex と
#  Cloudflare の連携(MCP)も設定します
#  ダブルクリックするだけでOKです
#  v1.10.4
# =====================================================

cd "$(dirname "$0")"
KIT_DIR=$(pwd -P)

# 「最後まで到達したか」を持っておき、そうでない終了だけを異常として扱う。
COMPLETED=0

finish() {
  status="${1:-0}"
  # finish が呼ばれた＝理由を表示したうえで意図的に終わる場合。
  # 重ねて「予期しない問題」と言わないよう、ここで完了扱いにする。
  COMPLETED=1
  echo ""
  # 端末が無い状況(CI・パイプ経由)で read を待つと固まる。install-mac.command と同じ判定にする。
  if [ "${AIDD_NONINTERACTIVE:-0}" != "1" ] && [ -t 0 ]; then
    read -r -p "Enterキーを押すとこのウィンドウを閉じられます..." _unused
  fi
  exit "$status"
}

# --- キットの自己修復 -------------------------------------------------
# install-mac.command の self_heal_kit と同一内容(package-kit.sh が一致を検査する)。
# 変更するときは両方を同時に直すこと。
#
# ブラウザ・メール・AirDrop 経由で受け取ったZIPを展開すると、中の全ファイルに
# 隔離属性(com.apple.quarantine)が伝播する。macOS 15 以降はこの属性が付いた
# .command をダブルクリックすると「Appleは…検証できませんでした」のダイアログ
# (既定ボタンが「ゴミ箱に入れる」)が出る。
# ターミナル経由の起動には隔離属性が適用されないため、この関数が動いている
# 時点で利用者は明示的に実行を選んでいる。ここでキット自身の状態を整えれば、
# 2回目以降はダブルクリックでも起動できるようになる。
#
# 方針:
#   - 対象範囲はキットのフォルダ全体。隔離属性は展開時に全ファイルへ伝播するため、
#     .command だけ外しても、後から開く .html マニュアルなどが残ってしまう。
#   - 告知は「実際に直したときだけ」。何も直していないのに毎回メッセージを出すと、
#     利用者は正常な出力と異常な出力を区別できなくなる。
#   - 失敗しても中断しない。自己修復はあくまで次回以降のための補助であり、
#     今回の導入自体は既に実行できている。中断させる理由がない。
self_heal_kit() {
  _chmodded=0

  # 隔離属性: 1つでも付いていれば、フォルダ全体からまとめて外す。
  #
  # 検出に find -xattrname を使ってはいけない。この述語は比較的新しい macOS に
  # しか無く、古い機では find が usage エラーで即座に終わる。2>/dev/null が
  # それを捨てるので「隔離属性は付いていない」と誤判定し、解除を黙って飛ばす。
  # つまり、いちばん古い機で、いちばん必要な処理だけが消える。
  # xattr はどのバージョンにも在るため、そちらで見る。
  if xattr -r "$KIT_DIR" 2>/dev/null | grep -q com.apple.quarantine; then
    if xattr -dr com.apple.quarantine "$KIT_DIR" 2>/dev/null; then
      echo "  ダブルクリックで開けるように、キットの隔離設定を解除しました。"
    else
      echo "  [注意] キットの隔離設定を解除できませんでした。"
      echo "  次回もダブルクリックで開けない場合は、ターミナルで次を実行してください:"
      echo "    xattr -dr com.apple.quarantine \"$KIT_DIR\""
    fi
  fi

  # 実行権限: ZIPの作り方や転送経路によっては失われる。
  for _f in "$KIT_DIR"/*.command "$KIT_DIR"/*.sh; do
    [ -f "$_f" ] || continue
    [ -x "$_f" ] && continue
    if chmod +x "$_f" 2>/dev/null; then
      _chmodded=1
    fi
  done
  if [ "$_chmodded" = "1" ]; then
    echo "  キットの実行権限を整えました。"
  fi

  unset _chmodded _f
  return 0
}

# --- 開発ツールの置き場所を吸収する ------------------------------------
# node / pnpm / claude / codex がどこに入っているかは利用者ごとに違う。
#   CPU         : Apple Silicon の Homebrew は /opt/homebrew、Intel は /usr/local
#   Node の入れ方 : pnpm / nvm / volta / asdf / mise / npm -g / bun
#   起動のしかた  : ダブルクリックとターミナル実行とで見える PATH が違う
#
# 「ありそうな場所」を数え上げる方式は必ず数え漏れる。そこで順番を逆にして、
#   (1) 利用者のログインシェルが実際に見ている PATH を借りる  ← 本命
#   (2) そのうえで標準的な置き場所を後ろに足す                ← (1) が空振りしたときの保険
# とする。(1) なら nvm や mise のように「設定ファイルを読んで初めて PATH に
# 載る」仕組みまで、こちらが個別に知らなくても拾える。
augment_path() {
  _extra=""

  # CI やオフラインfixtureは、渡された PATH だけを信頼境界にする。
  # このモードではログインシェルや標準的な追加先を探さない。
  # 通常実行のダブルクリックUXには影響させない明示的なテスト契約。
  if [ "${AIDD_PATH_MODE:-}" = "isolated" ]; then
    export PATH
    unset _extra
    return 0
  fi

  # (1) ログインシェルへ PATH を尋ねる。
  #     利用者のシェル設定が壊れている(過去に /opt/homebrew/bin/zsh が
  #     存在しない事例があった)、あるいは入力待ちで止まることがあるため、
  #     結果は目印つきで受け取り、5秒で打ち切る。
  if [ -n "${SHELL:-}" ] && [ -x "${SHELL:-}" ]; then
    _out=$(mktemp -t aidd-path 2>/dev/null) || _out=""
    if [ -n "$_out" ]; then
      "$SHELL" -lc 'printf "\nAIDD_PATH=%s\n" "$PATH"' >"$_out" 2>/dev/null </dev/null &
      _pid=$!
      _n=0
      while kill -0 "$_pid" 2>/dev/null && [ "$_n" -lt 50 ]; do
        sleep 0.1
        _n=$((_n + 1))
      done
      if kill -0 "$_pid" 2>/dev/null; then
        kill -9 "$_pid" 2>/dev/null || true
      fi
      wait "$_pid" 2>/dev/null || true
      # 目印の行だけを採る。シェル設定が何か表示していても混ざらない。
      _login_path=$(sed -n 's/^AIDD_PATH=//p' "$_out" 2>/dev/null | tail -n 1) || _login_path=""
      rm -f "$_out"
      case "$_login_path" in
        /*) _extra="$_extra:$_login_path" ;;
      esac
    fi
  fi

  # (2) 標準的な置き場所。Homebrew は両方の prefix を並べる
  #     (Rosetta 併用で Intel 版と Apple Silicon 版が同居することがある)。
  #     実在するものだけ足して、PATH が読めなくなるのを防ぐ。
  for _d in \
    /opt/homebrew/bin /opt/homebrew/sbin \
    /usr/local/bin /usr/local/sbin \
    "${PNPM_HOME:-}" "$HOME/Library/pnpm" "$HOME/.local/share/pnpm" \
    "$HOME/.volta/bin" "$HOME/.bun/bin" "$HOME/.asdf/shims" \
    "$HOME/.local/bin" "$HOME/.npm-global/bin" "${NVM_BIN:-}"
  do
    if [ -n "$_d" ] && [ -d "$_d" ]; then
      _extra="$_extra:$_d"
    fi
  done

  # 重複を潰す。害は無いが、不具合報告で PATH を見せてもらうときに読めなくなる。
  _new=""
  _seen=":"
  _oldifs=$IFS
  IFS=":"
  for _d in $PATH$_extra; do
    [ -n "$_d" ] || continue
    case "$_seen" in
      *":$_d:"*) continue ;;
    esac
    _seen="$_seen$_d:"
    if [ -z "$_new" ]; then _new="$_d"; else _new="$_new:$_d"; fi
  done
  IFS=$_oldifs
  PATH="$_new"
  export PATH

  unset _extra _out _pid _n _login_path _d _new _seen _oldifs
  return 0
}

# 異常終了の検知に ERR トラップを使わない理由:
#   ERR を関数の中まで届かせるには set -E が要る。ところが macOS 標準の
#   bash 3.2 では、条件文の中で失敗したコマンド置換
#   (例: `if existing=$(claude mcp get ...); then`) の ERR が、
#   本来は無視されるはずなのに後から関数内で発火する。
#   このスクリプトは MCP の状態確認でその書き方を多用するため、
#   「実際には処理が続くのに『中断しました』と表示される」ことになる。
#
#   そこで EXIT トラップで「最後まで到達したか」を見る方式にした。
#   コマンド置換のサブシェルは EXIT トラップを実行しないので誤爆せず、
#   関数の中で予期しない失敗が起きた場合(set -e で即終了する)は確実に拾える。
on_exit() {
  status=$?
  if [ "$COMPLETED" != "1" ] && [ "$status" != "0" ]; then
    echo ""
    echo "[エラー] 予期しない問題が発生したため中断しました。"
    echo "この画面のまま導入支援の担当者にお見せください。"
    COMPLETED=1
  fi
  exit "$status"
}

trap on_exit EXIT
set -e

self_heal_kit

echo ""
echo "==============================================="
echo "  開発環境セットアップ (Mac)"
echo "  Node.js と pnpm を準備します"
echo "==============================================="
echo ""

# --- ステップ 1/4: pnpm のインストール -------------------------
export PNPM_HOME="${PNPM_HOME:-$HOME/Library/pnpm}"
# 既に入っている node / pnpm を「見つけられなくて入れ直す」ことがないよう、
# 判定の前に PATH を整える。CPU や Node の入れ方の違いはここで吸収する。
augment_path

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
  # 入れた直後の場所を PATH に載せる(pnpm 本体・pnpm 管理の node の両方)。
  augment_path
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

# --- Node.js が「使える状態か」を見る ----------------------------------
# 「コマンドが在る」と「使える」は別。ここを分けないと、v12 が入った機で
# 判定だけ通り、後段の wrangler や Claude Code が意味不明に失敗する。
# 失敗する場所と原因の場所が離れるほど、非エンジニアには手が出せなくなる。
# 最低バージョンは Mac / Windows で別々に持たず、キット直下の
# NODE_MIN_MAJOR だけを正本にする。読めない・数値でない場合は、古い
# 既定値で黙って続けず配布物の欠落として停止する。
NODE_MIN_MAJOR=$(tr -d ' \t\r\n' < "$KIT_DIR/NODE_MIN_MAJOR" 2>/dev/null) || NODE_MIN_MAJOR=""
case "$NODE_MIN_MAJOR" in
  ''|*[!0-9]*|0)
    echo "[エラー] キットの NODE_MIN_MAJOR が無いか、正しい数値ではありません。"
    echo "キットを再度ダウンロードしてから、もう一度実行してください。"
    finish 1
    ;;
esac

node_major() {
  # "v22.3.1" -> "22"。数字以外が来たら空を返す(呼び出し側で弾く)。
  _v="${1#v}"
  _v="${_v%%.*}"
  case "$_v" in
    ''|*[!0-9]*) printf '' ;;
    *) printf '%s' "$_v" ;;
  esac
  unset _v
}

# CPU と Node のアーキが食い違っていないか。
# Apple Silicon 機で x64 の Node が使われている状態は、実際に起きる:
#   - Rosetta 下のターミナルで入れた
#   - Volta の toolchain が x64 のまま引き継がれた
# Rosetta があれば動いてしまうため誰も気づかず、あとから速度や
# ネイティブモジュールの不整合として出る。動くので止めはしないが、必ず言う。
warn_arch_mismatch() {
  _cpu=$(uname -m 2>/dev/null) || _cpu=""
  _node_arch=$(node -p 'process.arch' 2>/dev/null) || _node_arch=""
  if [ "$_cpu" = "arm64" ] && [ "$_node_arch" = "x64" ]; then
    echo "      [注意] この Mac は Apple Silicon ですが、Node.js は Intel 版です。"
    echo "             動きますが遅くなり、一部の部品が入らないことがあります。"
    echo "             使用中の Node.js: $(command -v node)"
    echo "             作り直す場合: pnpm env use --global lts"
  fi
  unset _cpu _node_arch
}

# 古すぎるなら、黙って通さず、その場で入れ直しを試みる。
ensure_node_ok() {
  _major=$(node_major "$NODE_VERSION")
  if [ -n "$_major" ] && [ "$_major" -ge "$NODE_MIN_MAJOR" ]; then
    warn_arch_mismatch
    unset _major
    return 0
  fi

  echo "      Node.js $NODE_VERSION は古すぎます (v$NODE_MIN_MAJOR 以上が必要)。"
  echo "      新しい Node.js を入れています(2〜3分)..."
  pnpm env use --global lts || true
  augment_path
  NODE_VERSION=$(node --version 2>/dev/null) || NODE_VERSION=""
  _major=$(node_major "$NODE_VERSION")
  if [ -z "$_major" ] || [ "$_major" -lt "$NODE_MIN_MAJOR" ]; then
    echo ""
    echo "[エラー] Node.js を v$NODE_MIN_MAJOR 以上にできませんでした"
    echo "        (現在: ${NODE_VERSION:-判定できません})。"
    # どの道具が管理している node なのかが分かれば、支援側は即座に判断できる。
    echo "        使用中の Node.js: $(command -v node 2>/dev/null || echo 見つかりません)"
    echo "        nvm / Volta / asdf などで固定されている可能性があります。"
    echo "        この画面のまま導入支援の担当者にお見せください。"
    finish 1
  fi
  echo "      Node.js $NODE_VERSION に更新しました"
  warn_arch_mismatch
  unset _major
  return 0
}

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
  ensure_node_ok
else
  echo "      Node.js をインストールしています(2〜3分)..."
  pnpm env use --global lts
  # 入れた直後の場所を PATH に載せる(pnpm 本体・pnpm 管理の node の両方)。
  augment_path
  NODE_VERSION=""
  if ! command -v node >/dev/null 2>&1 ||
     ! NODE_VERSION=$(node --version 2>/dev/null) ||
     [ -z "${NODE_VERSION//[[:space:]]/}" ]; then
    echo "[エラー] Node.js のインストールに失敗しました。"
    echo "この画面のまま導入支援の担当者にお見せください。"
    finish 1
  fi
  echo "      Node.js $NODE_VERSION をインストールしました"
  # 入れた直後でも確認する。pnpm が LTS を入れたつもりでも、PATH の先頭に
  # 別の道具(Volta 等)が管理する古い node が居れば、そちらが使われる。
  ensure_node_ok
fi

# --- ステップ 3/4: AI開発ツールと Cloudflare の連携(MCP) ---------
echo "(3/4) Claude Code / Codex と Cloudflare の連携を設定しています..."

MCP_FAILURES=0
MCP_PENDING=0
# CLI が見つからず設定を飛ばした数。これを数えないと「何も設定していないのに
# 完全に完了しました」と表示してしまう(下の最終判定で使う)。
# 名前を1つの変数に連ねて for で回すと "Claude Code" が空白で割れる。
# 対象は2つと決まっているので、素直に別々のフラグで持つ。
MCP_SKIPPED=0
CLAUDE_SKIPPED=0
CODEX_SKIPPED=0
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
  # 「見つからない」の理由は1つではない。未導入のほかに、導入済みだが PATH に
  # 載っていない・別シェルの alias としてしか存在しない、という状態がある。
  # どれなのかをこちらは決められないので、断定せず両方の道を示す。
  echo "      Claude Code: スキップ(コマンド claude が見つかりません)"
  echo "        未導入なら Claude Code をインストールしてください。"
  echo "        導入済みのはずなら、ターミナルを開き直してから再実行してください。"
  MCP_SKIPPED=$((MCP_SKIPPED + 1))
  CLAUDE_SKIPPED=1
fi

if command -v codex >/dev/null 2>&1; then
  configure_codex_mcp cloudflare-bindings https://bindings.mcp.cloudflare.com/mcp
  configure_codex_mcp cloudflare-docs https://docs.mcp.cloudflare.com/mcp
else
  echo "      OpenAI Codex: スキップ(コマンド codex が見つかりません)"
  echo "        未導入なら Codex CLI をインストールしてください。"
  echo "        導入済みのはずなら、ターミナルを開き直してから再実行してください。"
  MCP_SKIPPED=$((MCP_SKIPPED + 1))
  CODEX_SKIPPED=1
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
# CLI が1つでも見つからなければ、その分の連携は設定できていない。
# ここを見ずに「完全に完了しました」と出すと、Claude Code をデスクトップアプリ
# だけで使っている利用者(CLI 未導入)には、何も設定していないのに完了と伝わる。
# 表示は必ず、実際にやれたことの範囲までにとどめる。
if [ "$MCP_SKIPPED" -gt 0 ]; then
  echo "==============================================="
  echo "  基本セットアップ完了 / 一部の連携は未設定"
  echo "==============================================="
  echo ""
  echo "Node.js と pnpm の準備は終わりました。"
  echo "次のツールが見つからなかったため、Cloudflare 連携は設定していません:"
  if [ "$CLAUDE_SKIPPED" -eq 1 ]; then echo "  - Claude Code (claude)"; fi
  if [ "$CODEX_SKIPPED" -eq 1 ]; then echo "  - OpenAI Codex (codex)"; fi
  echo ""
  echo "そのツールを使う予定があるなら、導入してからこのセットアップを"
  echo "もう一度実行してください。使わないのであれば、このままで問題ありません。"
  echo ""
  echo "開いているターミナルがあれば、一度閉じて開き直してください。"
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
