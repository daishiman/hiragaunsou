#!/bin/bash
# =====================================================
#  AI開発エージェントキット インストーラー (Mac用)
#  ダブルクリックするだけでインストールされます
#  既に導入済みの場合は「このキットの内容が正」として
#  上書き更新し、廃止された古いスキルは自動で整理します
#  v1.6.0
# =====================================================
cd "$(dirname "$0")"

KIT_VERSION="1.6.0"
CLAUDE_DIR="$HOME/.claude"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$CLAUDE_DIR/backup-$STAMP"
# このキットが「自分で入れたもの」を記録するファイル。
# 次回の更新時に、新しいキットに含まれなくなったものだけを安全に整理するために使う。
MANIFEST="$CLAUDE_DIR/aidd-agent-kit.manifest"
VERSION_FILE="$CLAUDE_DIR/aidd-agent-kit.version"

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

# --- ステップ 1/6: キット本体の確認 ---------------------------
if [ ! -d "skills" ] || [ ! -d "agents" ] || [ ! -d "commands" ]; then
  echo "[エラー] インストールに必要なフォルダが見つかりません。"
  echo ""
  echo "ZIPを「展開」してできたフォルダの中にある install-mac.command を"
  echo "実行してください。ZIPの中身を直接ダブルクリックすると失敗します。"
  finish 1
fi

# --- ステップ 2/6: インストール先の確認 -------------------------
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

# 既に導入済みなら、更新であることを表示する(後からインストールした方が正)
if [ -f "$VERSION_FILE" ]; then
  PREV_VERSION=$(head -n 1 "$VERSION_FILE")
  echo "現在インストールされているバージョン: $PREV_VERSION"
  echo "このキット($KIT_VERSION)の内容で上書き更新します。"
  echo "(常に、後からインストールしたキットの内容が正になります)"
  echo "使用中に蓄積されたナレッジ(各スキル内の knowledge/ など、"
  echo "キットが配布していない追加ファイル)は消さずにそのまま残します。"
  echo ""
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

# --- ステップ 3/6: 既存ファイルのバックアップ --------------------
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
  echo "このキットの内容で上書きします(上書き前にバックアップを作成します)。"
  echo ""
  for item in $CONFLICTS; do
    mkdir -p "$BACKUP_DIR/$(dirname "$item")"
    cp -R "$CLAUDE_DIR/$item" "$BACKUP_DIR/$item"
  done
  echo "  バックアップ先: $BACKUP_DIR"
  echo ""
fi

# --- ステップ 4/6: 廃止された古いスキル等の整理 -------------------
# 「以前このキットが入れたもの(記録ファイルにある)」のうち、
# 「新しいキットには含まれないもの」だけをバックアップへ移動する。
# ユーザーが自分で追加したスキル等には一切触れない。
if [ -f "$MANIFEST" ]; then
  REMOVED=0
  while IFS= read -r item; do
    # 安全装置: 想定パス以外・上位フォルダ参照は無視する
    case "$item" in *..*) continue ;; esac
    case "$item" in
      skills/*|agents/*.md|commands/*.md) ;;
      *) continue ;;
    esac
    [ -e "$CLAUDE_DIR/$item" ] || continue
    if [ ! -e "$item" ]; then
      mkdir -p "$BACKUP_DIR/$(dirname "$item")"
      cp -R "$CLAUDE_DIR/$item" "$BACKUP_DIR/$item"
      rm -rf "${CLAUDE_DIR:?}/$item"
      REMOVED=$((REMOVED + 1))
    fi
  done < "$MANIFEST"
  if [ "$REMOVED" -gt 0 ]; then
    echo "新しいキットに含まれなくなった古いスキル等を ${REMOVED} 件、"
    echo "バックアップへ移動して整理しました。"
    echo "(中にナレッジが入っていた場合もバックアップに残っています)"
    echo ""
  fi
fi

# --- ステップ 5/6: コピー ------------------------------------
echo "(1/3) スキル(開発ノウハウ集)をコピーしています..."
cp -R skills/. "$CLAUDE_DIR/skills/"

echo "(2/3) エージェント(自動開発の司令塔)をコピーしています..."
cp -R agents/. "$CLAUDE_DIR/agents/"

echo "(3/3) コマンド(/build-app, /improve-app, /undo-app, /setup-cicd)をコピーしています..."
cp -R commands/. "$CLAUDE_DIR/commands/"

echo ""

# --- ステップ 6/6: 全件検証と導入記録の更新 ----------------------
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
  # 今回入れたものの一覧を記録する(次回更新時の整理に使う)
  {
    for dir in skills/*/; do echo "skills/$(basename "$dir")"; done
    for f in agents/*.md; do [ -e "$f" ] && echo "$f"; done
    for f in commands/*.md; do [ -e "$f" ] && echo "$f"; done
  } > "$MANIFEST"
  echo "$KIT_VERSION" > "$VERSION_FILE"

  echo "==============================================="
  echo "  インストールが完了しました！"
  echo "==============================================="
  echo ""
  echo "  スキル: ${INSTALLED_SKILLS}個 / ${EXPECTED_SKILLS}個"
  echo "  エージェント: app-orchestrator"
  echo "  コマンド: /build-app, /improve-app, /undo-app, /setup-cicd"
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
