#!/bin/bash
# =====================================================
#  AI開発エージェントキット インストーラー (Mac用)
#  ダブルクリックするだけでインストールされます
#  v1.1.0
# =====================================================
cd "$(dirname "$0")"

KIT_VERSION="1.1.0"
CLAUDE_DIR="$HOME/.claude"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$CLAUDE_DIR/backup-$STAMP"

# 画面を閉じずにメッセージを見せてから終了する
finish() {
  echo ""
  read -p "Enterキーを押すとこのウィンドウを閉じられます..."
  exit "${1:-0}"
}

# 想定外のエラーで無言終了しないようにする
trap 'echo ""; echo "[エラー] 予期しない問題が発生したため中断しました。"; echo "マニュアルの「うまくいかないとき」をご覧ください。"; finish 1' ERR
set -e

echo ""
echo "==============================================="
echo "  AI開発エージェントキット インストーラー (Mac)"
echo "  バージョン $KIT_VERSION"
echo "==============================================="
echo ""

# --- ステップ 1/5: キット本体の確認 ---------------------------
if [ ! -d "skills" ] || [ ! -d "agents" ] || [ ! -d "commands" ]; then
  echo "[エラー] インストールに必要なフォルダが見つかりません。"
  echo ""
  echo "ZIPを「展開」してできたフォルダの中にある install-mac.command を"
  echo "実行してください。ZIPの中身を直接ダブルクリックすると失敗します。"
  finish 1
fi

# --- ステップ 2/5: インストール先の確認 -------------------------
echo "インストール先: $CLAUDE_DIR"
echo ""

if [ ! -d "$CLAUDE_DIR" ]; then
  echo "[確認] $CLAUDE_DIR が見つかりません。"
  echo ""
  echo "Claude Code をまだ一度も起動していない可能性があります。"
  echo "先に Claude Code を起動してサインインを済ませてから、"
  echo "もう一度このインストーラーを実行してください。"
  finish 1
fi

# 書き込み先がシンボリックリンク（別の場所への近道）になっていないか調べる。
# リンクのままコピーすると、意図しない別のフォルダに書き込まれてしまう。
check_symlink() {
  target="$1"   # 調べるパス
  label="$2"    # 画面に出す名前

  if [ -L "$target" ]; then
    linked_to=$(readlink "$target")
    echo "[確認] $CLAUDE_DIR/$label は、別の場所への「近道(リンク)」になっています。"
    echo ""
    echo "  リンク先: $linked_to"
    echo ""
    echo "このままコピーすると、上のリンク先のフォルダが書き換えられてしまいます。"
    echo "関係のない場所を壊さないよう、インストールを中断しました。"
    echo ""
    echo "対処方法(詳しい方向け):"
    echo "  1. ターミナルで次を実行し、リンクを一時的に退避します"
    echo "       mv \"$CLAUDE_DIR/$label\" \"$CLAUDE_DIR/$label.bak\""
    echo "  2. もう一度このインストーラーを実行します"
    echo ""
    echo "ご不明な場合は、この画面のまま導入支援の担当者にお見せください。"
    finish 1
  fi
}

check_symlink "$CLAUDE_DIR/skills"   "skills"
check_symlink "$CLAUDE_DIR/agents"   "agents"
check_symlink "$CLAUDE_DIR/commands" "commands"

mkdir -p "$CLAUDE_DIR/skills" "$CLAUDE_DIR/agents" "$CLAUDE_DIR/commands"

# --- ステップ 3/5: 既存ファイルのバックアップ --------------------
CONFLICTS=""
for dir in skills/*/; do
  name=$(basename "$dir")
  if [ -e "$CLAUDE_DIR/skills/$name" ]; then
    CONFLICTS="$CONFLICTS skills/$name"
  fi
done
for f in agents/*.md commands/*.md; do
  [ -e "$f" ] || continue
  if [ -e "$CLAUDE_DIR/$f" ]; then
    CONFLICTS="$CONFLICTS $f"
  fi
done

if [ -n "$CONFLICTS" ]; then
  COUNT=$(echo $CONFLICTS | wc -w | tr -d ' ')
  echo "同じ名前のファイルが ${COUNT} 件見つかりました。"
  echo "上書きする前に、念のためバックアップを作成します。"
  echo ""
  for item in $CONFLICTS; do
    mkdir -p "$BACKUP_DIR/$(dirname "$item")"
    cp -R "$CLAUDE_DIR/$item" "$BACKUP_DIR/$item"
  done
  echo "  バックアップ先: $BACKUP_DIR"
  echo ""
fi

# --- ステップ 4/5: コピー ------------------------------------
echo "(1/3) スキル(開発ノウハウ集)をコピーしています..."
cp -R skills/. "$CLAUDE_DIR/skills/"

echo "(2/3) エージェント(自動開発の司令塔)をコピーしています..."
cp -R agents/. "$CLAUDE_DIR/agents/"

echo "(3/3) コマンド(/build-app)をコピーしています..."
cp -R commands/. "$CLAUDE_DIR/commands/"

echo ""

# --- ステップ 5/5: 全件検証 -----------------------------------
set +e
MISSING=""

EXPECTED_SKILLS=0
INSTALLED_SKILLS=0
for dir in skills/*/; do
  name=$(basename "$dir")
  EXPECTED_SKILLS=$((EXPECTED_SKILLS + 1))
  if [ -f "$CLAUDE_DIR/skills/$name/SKILL.md" ]; then
    INSTALLED_SKILLS=$((INSTALLED_SKILLS + 1))
  else
    MISSING="$MISSING  - スキル: $name"$'\n'
  fi
done

for f in agents/*.md commands/*.md; do
  [ -e "$f" ] || continue
  if [ ! -f "$CLAUDE_DIR/$f" ]; then
    MISSING="$MISSING  - $f"$'\n'
  fi
done

if [ -z "$MISSING" ]; then
  echo "==============================================="
  echo "  インストールが完了しました！"
  echo "==============================================="
  echo ""
  echo "  スキル: ${INSTALLED_SKILLS}個 / ${EXPECTED_SKILLS}個"
  echo "  エージェント: app-orchestrator"
  echo "  コマンド: /build-app"
  if [ -n "$CONFLICTS" ]; then
    echo ""
    echo "  以前のファイルは次の場所に保存してあります:"
    echo "  $BACKUP_DIR"
  fi
  echo ""
  echo "次にやること:"
  echo "  1. Claude Code を終了して起動し直す(Command + Q で完全終了)"
  echo "  2. 「/build-app 作りたいものの説明」と入力する"
  finish 0
else
  echo "[エラー] 次のものをインストールできませんでした。"
  echo ""
  printf "%s" "$MISSING"
  echo ""
  echo "スキル: ${INSTALLED_SKILLS}個 / ${EXPECTED_SKILLS}個 のみ成功"
  echo ""
  echo "マニュアルの「うまくいかないとき」の Q1(手動コピー)をお試しください。"
  finish 1
fi
