#!/bin/bash
# shellcheck disable=SC2329
# =====================================================
#  AI開発エージェントキット インストーラー (Mac用)
#  Claude Code と OpenAI Codex の両方へ同時導入します
#  v1.9.0
# =====================================================

set -Ee
cd "$(dirname "$0")"

KIT_VERSION="1.9.0"
INSTALL_HOME="$HOME"
while case "$INSTALL_HOME" in *'//'*) true ;; *) false ;; esac; do
  INSTALL_HOME=${INSTALL_HOME//\/\//\/}
done
INSTALL_HOME=${INSTALL_HOME%/}
CLAUDE_DIR="$INSTALL_HOME/.claude"
CODEX_DIR="${CODEX_HOME:-$INSTALL_HOME/.codex}"
while case "$CODEX_DIR" in *'//'*) true ;; *) false ;; esac; do
  CODEX_DIR=${CODEX_DIR//\/\//\/}
done
CODEX_DIR=${CODEX_DIR%/}
CODEX_SKILLS_DIR="$INSTALL_HOME/.agents/skills"
STAMP=$(date +%Y%m%d-%H%M%S)
CLAUDE_BACKUP_DIR="$CLAUDE_DIR/backup-$STAMP"
CODEX_BACKUP_DIR="$CODEX_DIR/backup-$STAMP"
CLAUDE_MANIFEST="$CLAUDE_DIR/aidd-agent-kit.manifest"
CLAUDE_VERSION_FILE="$CLAUDE_DIR/aidd-agent-kit.version"
CODEX_MANIFEST="$CODEX_DIR/aidd-agent-kit.manifest"
CODEX_VERSION_FILE="$CODEX_DIR/aidd-agent-kit.version"
LEGACY_PROMPTS=0
TRANSACTION_ACTIVE=0
WORK_DIR=""

finish() {
  status="${1:-0}"
  echo ""
  if [ -t 0 ]; then
    read -r -p "Enterキーを押すとこのウィンドウを閉じられます..." _unused
  fi
  exit "$status"
}

cleanup() {
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
}

target_for() {
  client="$1"
  relative="$2"
  if [ "$client" = "C" ]; then
    printf '%s/%s\n' "$CLAUDE_DIR" "$relative"
  else
    case "$relative" in
      skills/*) printf '%s/%s\n' "$CODEX_SKILLS_DIR" "${relative#skills/}" ;;
      *) printf '%s/%s\n' "$CODEX_DIR" "$relative" ;;
    esac
  fi
}

backup_root_for() {
  if [ "$1" = "C" ]; then
    printf '%s\n' "$CLAUDE_BACKUP_DIR"
  else
    printf '%s\n' "$CODEX_BACKUP_DIR"
  fi
}

rollback() {
  [ "$TRANSACTION_ACTIVE" -eq 1 ] || return 0
  echo "[復元] 途中までの変更を元に戻しています..."
  while IFS='|' read -r client relative existed; do
    [ -n "$client" ] || continue
    target=$(target_for "$client" "$relative")
    backup_root=$(backup_root_for "$client")
    rm -rf "$target"
    if [ "$existed" = "1" ]; then
      mkdir -p "$(dirname "$target")"
      cp -pR "$backup_root/$relative" "$target" || true
    fi
  done < "$WORK_DIR/rollback-items"
  TRANSACTION_ACTIVE=0
  echo "[復元] インストール前の状態へ戻しました。"
}

on_error() {
  trap - ERR INT TERM
  set +e
  rollback
  cleanup
  echo ""
  echo "[エラー] インストールを完了できなかったため中断しました。"
  echo "部分的な導入は残さず、可能な範囲で元の状態へ復元しました。"
  finish 1
}

trap on_error ERR INT TERM
trap cleanup EXIT

case "$CLAUDE_DIR|$CODEX_DIR|$CODEX_SKILLS_DIR" in
  /*'|'/*'|'/*) ;;
  *)
    echo "[エラー] HOME と CODEX_HOME は絶対パスで指定してください。"
    finish 1
    ;;
esac

for arg in "$@"; do
  case "$arg" in
    --legacy-prompts) LEGACY_PROMPTS=1 ;;
    *)
      echo "[エラー] 未対応のオプションです: $arg"
      echo "使用可能: --legacy-prompts"
      finish 1
      ;;
  esac
done

echo ""
echo "==============================================="
echo "  AI開発エージェントキット インストーラー (Mac)"
echo "  Claude Code + OpenAI Codex / $KIT_VERSION"
echo "==============================================="
echo ""

# --- ステップ 1/6: コピー元と形式の事前検証 ----------------------
for required in skills agents commands codex/skills codex/agents; do
  if [ ! -d "$required" ]; then
    echo "[エラー] インストールに必要なフォルダが見つかりません: $required"
    echo "ZIPを展開後、その中の install-mac.command を実行してください。"
    finish 1
  fi
done
if [ "$LEGACY_PROMPTS" -eq 1 ] && [ ! -d "codex/prompts" ]; then
  echo "[エラー] legacy prompts のコピー元が見つかりません: codex/prompts"
  finish 1
fi
if [ ! -f "agents/app-orchestrator.md" ] || \
   [ ! -f "codex/app-orchestrator-openai.yaml" ]; then
  echo "[エラー] app-orchestrator のCodex用ファイルが揃っていません。"
  finish 1
fi

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/aidd-agent-kit.XXXXXX")
: > "$WORK_DIR/maps"
: > "$WORK_DIR/skill-names"
: > "$WORK_DIR/affected"
: > "$WORK_DIR/rollback-items"
: > "$WORK_DIR/check-paths"

validate_skill() {
  file="$1"
  expected="$2"
  actual=$(awk '
    NR == 1 && $0 != "---" { exit 20 }
    NR > 1 && $0 == "---" { closed=1; exit }
    NR > 1 && $1 == "name:" { sub(/^[[:space:]]*name:[[:space:]]*/, ""); name=$0 }
    NR > 1 && $1 == "description:" { sub(/^[[:space:]]*description:[[:space:]]*/, ""); desc=$0 }
    END { if (!closed || name == "" || desc == "") exit 21; print name }
  ' "$file") || {
    echo "[エラー] SKILL.md のfrontmatterが不正です: $file"
    return 1
  }
  if [ "$actual" != "$expected" ]; then
    echo "[エラー] スキル名と配布先名が一致しません: $file"
    echo "  name: $actual / 配布先: $expected"
    return 1
  fi
  case "$actual" in
    ''|*[!a-z0-9-]*|-*|*-) echo "[エラー] スキル名が不正です: $actual"; return 1 ;;
  esac
  if grep -Fx "$actual" "$WORK_DIR/skill-names" >/dev/null 2>&1; then
    echo "[エラー] Codexで同名になるスキルが重複しています: $actual"
    return 1
  fi
  printf '%s\n' "$actual" >> "$WORK_DIR/skill-names"
}

for dir in skills/*/ codex/skills/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  [ -f "$dir/SKILL.md" ] || {
    echo "[エラー] SKILL.md がありません: $dir"
    finish 1
  }
  validate_skill "$dir/SKILL.md" "$name" || finish 1
done
validate_skill "agents/app-orchestrator.md" "app-orchestrator" || finish 1

for toml in codex/agents/*.toml; do
  [ -f "$toml" ] || continue
  if command -v python3 >/dev/null 2>&1 && python3 -c 'import tomllib' >/dev/null 2>&1; then
    python3 - "$toml" <<'PY' || {
import re
import sys
import tomllib

with open(sys.argv[1], "rb") as source:
    data = tomllib.load(source)
required = {"name", "description", "developer_instructions"}
if set(data) != required:
    raise SystemExit(1)
if not re.fullmatch(r"[a-z][a-z0-9_]*", data["name"]):
    raise SystemExit(1)
if any(not isinstance(data[key], str) or not data[key].strip() for key in required):
    raise SystemExit(1)
PY
      echo "[エラー] CodexカスタムエージェントのTOML構文または必須形式が不正です: $toml"
      finish 1
    }
  elif ! awk '
    function fail() { bad=1 }
    inblock {
      if ($0 ~ /^[[:space:]]*"""[[:space:]]*$/) { inblock=0; closed=1 }
      next
    }
    /^[[:space:]]*($|#)/ { next }
    /^[[:space:]]*name[[:space:]]*=[[:space:]]*"[a-z][a-z0-9_]*"[[:space:]]*$/ {
      if (name++) fail(); next
    }
    /^[[:space:]]*description[[:space:]]*=[[:space:]]*"[^"\r\n]+"[[:space:]]*$/ {
      if (description++) fail(); next
    }
    /^[[:space:]]*developer_instructions[[:space:]]*=[[:space:]]*"""[[:space:]]*$/ {
      if (instructions++) fail(); inblock=1; next
    }
    { fail() }
    END { if (bad || inblock || !closed || name != 1 || description != 1 || instructions != 1) exit 1 }
  ' "$toml"; then
    echo "[エラー] Codexカスタムエージェントの必須形式が不正です: $toml"
    finish 1
  fi
done

SOURCE_LINK_ROOTS="skills agents commands codex/skills codex/agents"
if [ "$LEGACY_PROMPTS" -eq 1 ]; then
  SOURCE_LINK_ROOTS="$SOURCE_LINK_ROOTS codex/prompts"
fi
# shellcheck disable=SC2086
if find $SOURCE_LINK_ROOTS -type l -print -quit | grep . >/dev/null 2>&1 || \
   [ -L "codex/app-orchestrator-openai.yaml" ]; then
  echo "[エラー] コピー元にシンボリックリンクが含まれています。"
  finish 1
fi

append_tree() {
  client="$1"
  source_root="$2"
  relative_root="$3"
  find "$source_root" -type f -print | LC_ALL=C sort | while IFS= read -r source; do
    suffix=${source#"$source_root"/}
    printf '%s|%s|%s/%s\n' "$client" "$source" "$relative_root" "$suffix"
  done >> "$WORK_DIR/maps"
}

append_tree C skills skills
append_tree C agents agents
append_tree C commands commands
append_tree X skills skills
append_tree X codex/skills skills
printf '%s\n' 'X|agents/app-orchestrator.md|skills/app-orchestrator/SKILL.md' >> "$WORK_DIR/maps"
printf '%s\n' 'X|codex/app-orchestrator-openai.yaml|skills/app-orchestrator/agents/openai.yaml' >> "$WORK_DIR/maps"
append_tree X codex/agents agents
if [ "$LEGACY_PROMPTS" -eq 1 ]; then
  append_tree X codex/prompts prompts
fi

if awk -F'|' '{ print $1 "|" $3 }' "$WORK_DIR/maps" | LC_ALL=C sort | uniq -d | grep . >/dev/null 2>&1; then
  echo "[エラー] 複数のコピー元が同じ配布先を使用しています。"
  finish 1
fi

valid_relative() {
  relative="$1"
  case "$relative" in
    ''|/*|*'|'*|*\\*) return 1 ;;
  esac
  case "/$relative/" in
    */../*|*/./*) return 1 ;;
  esac
  case "$relative" in
    skills/*|agents/*|commands/*|prompts/*|aidd-agent-kit.manifest|aidd-agent-kit.version) return 0 ;;
    *) return 1 ;;
  esac
}

top_item() {
  relative="$1"
  case "$relative" in
    skills/*/*) rest=${relative#skills/}; printf 'skills/%s\n' "${rest%%/*}" ;;
    *) printf '%s\n' "$relative" ;;
  esac
}

while IFS='|' read -r client source relative; do
  case "$source" in *'|'*)
    echo "[エラー] コピー元パスに使用できない文字があります: $source"
    finish 1
    ;;
  esac
  valid_relative "$relative" || {
    echo "[エラー] 安全でない配布先です: $relative"
    finish 1
  }
  printf '%s|%s\n' "$client" "$(top_item "$relative")" >> "$WORK_DIR/affected"
  printf '%s|%s\n' "$client" "$relative" >> "$WORK_DIR/check-paths"
done < "$WORK_DIR/maps"

collect_old_manifest() {
  client="$1"
  manifest="$2"
  [ -f "$manifest" ] || return 0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in *'|'*) relative=${line#*|} ;; *) relative=$line ;; esac
    valid_relative "$relative" || continue
    printf '%s|%s\n' "$client" "$(top_item "$relative")" >> "$WORK_DIR/affected"
    printf '%s|%s\n' "$client" "$relative" >> "$WORK_DIR/check-paths"
  done < "$manifest"
}

collect_old_manifest C "$CLAUDE_MANIFEST"
collect_old_manifest X "$CODEX_MANIFEST"
printf '%s\n' \
  'C|aidd-agent-kit.manifest' 'C|aidd-agent-kit.version' \
  'X|aidd-agent-kit.manifest' 'X|aidd-agent-kit.version' >> "$WORK_DIR/affected"
printf '%s\n' \
  'C|aidd-agent-kit.manifest' 'C|aidd-agent-kit.version' \
  'X|aidd-agent-kit.manifest' 'X|aidd-agent-kit.version' >> "$WORK_DIR/check-paths"
LC_ALL=C sort -u "$WORK_DIR/affected" -o "$WORK_DIR/affected"
LC_ALL=C sort -u "$WORK_DIR/check-paths" -o "$WORK_DIR/check-paths"

# --- ステップ 2/6: 上書き先と祖先リンクの安全確認 ---------------
echo "Claude Code: $CLAUDE_DIR"
echo "Codex skills: $CODEX_SKILLS_DIR"
echo "Codex agents: $CODEX_DIR"
if [ "$LEGACY_PROMPTS" -eq 1 ]; then
  echo "Codex legacy prompts: 有効"
fi
echo ""

check_path_chain() {
  path="$1"
  boundary="$2"
  current="$path"
  while [ -n "$current" ]; do
    if [ -L "$current" ]; then
      echo "[確認] 上書き対象またはその祖先がリンクになっています。"
      echo "  対象: $path"
      echo "  リンク: $current -> $(readlink "$current")"
      return 1
    fi
    [ "$current" = "$boundary" ] && return 0
    [ "$current" = "/" ] && break
    case "$current" in
      */*) current=${current%/*}; [ -n "$current" ] || current="/" ;;
      *) current="" ;;
    esac
  done
  echo "[エラー] 上書き対象が想定したインストール先の外にあります: $path"
  return 1
}

check_path_chain "$CLAUDE_BACKUP_DIR" "$INSTALL_HOME" || finish 1
check_path_chain "$CODEX_BACKUP_DIR" "$CODEX_DIR" || finish 1

while IFS='|' read -r client relative; do
  target=$(target_for "$client" "$relative")
  if [ "$client" = "C" ]; then
    boundary="$INSTALL_HOME"
  else
    case "$relative" in
      skills/*) boundary="$INSTALL_HOME" ;;
      *) boundary="$CODEX_DIR" ;;
    esac
  fi
  check_path_chain "$target" "$boundary" || finish 1
done < "$WORK_DIR/check-paths"

# --- ステップ 3/6: 全変更対象のバックアップ ----------------------
backup_item() {
  client="$1"
  relative="$2"
  target=$(target_for "$client" "$relative")
  backup_root=$(backup_root_for "$client")
  if [ -e "$target" ]; then
    mkdir -p "$backup_root/$(dirname "$relative")"
    cp -pR "$target" "$backup_root/$relative"
    diff -qr "$target" "$backup_root/$relative" >/dev/null
    printf '%s|%s|1\n' "$client" "$relative" >> "$WORK_DIR/rollback-items"
  else
    printf '%s|%s|0\n' "$client" "$relative" >> "$WORK_DIR/rollback-items"
  fi
}

while IFS='|' read -r client relative; do
  backup_item "$client" "$relative"
done < "$WORK_DIR/affected"
TRANSACTION_ACTIVE=1

if [ -d "$CLAUDE_BACKUP_DIR" ]; then
  echo "Claude Code の変更対象を検証付きでバックアップしました: $CLAUDE_BACKUP_DIR"
fi
if [ -d "$CODEX_BACKUP_DIR" ]; then
  echo "Codex の変更対象を検証付きでバックアップしました: $CODEX_BACKUP_DIR"
fi

# --- ステップ 4/6: 旧manifest所有ファイルの整理 -------------------
# shasumをファイルごとに起動せず、1プロセスでコピー元hashを作る。
awk -F'|' '{ print $2 }' "$WORK_DIR/maps" | LC_ALL=C sort -u > "$WORK_DIR/sources"
perl -MDigest::SHA -e '
  while (<STDIN>) {
    chomp;
    open my $fh, "<", $_ or die "$!: $_\n";
    binmode $fh;
    my $sha = Digest::SHA->new(256);
    $sha->addfile($fh);
    print $sha->hexdigest, "|", $_, "\n";
  }
' < "$WORK_DIR/sources" > "$WORK_DIR/source-hashes"

awk -F'|' '
  NR == FNR { hash[$2]=$1; next }
  $1 == "C" { print hash[$2] "|" $3 }
' "$WORK_DIR/source-hashes" "$WORK_DIR/maps" | LC_ALL=C sort -u > "$WORK_DIR/claude.manifest"
awk -F'|' '
  NR == FNR { hash[$2]=$1; next }
  $1 == "X" { print hash[$2] "|" $3 }
' "$WORK_DIR/source-hashes" "$WORK_DIR/maps" | LC_ALL=C sort -u > "$WORK_DIR/codex.manifest"

new_has_relative() {
  client="$1"
  relative="$2"
  awk -F'|' -v c="$client" -v r="$relative" '$1 == c && $3 == r { found=1 } END { exit !found }' "$WORK_DIR/maps"
}

new_has_prefix() {
  client="$1"
  relative="$2"
  awk -F'|' -v c="$client" -v p="$relative/" \
    '$1 == c && index($3, p) == 1 { found=1 } END { exit !found }' \
    "$WORK_DIR/maps"
}

clean_stale() {
  client="$1"
  manifest="$2"
  [ -f "$manifest" ] || return 0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    old_hash=""
    case "$line" in
      *'|'*) old_hash=${line%%|*}; relative=${line#*|} ;;
      *) relative=$line ;;
    esac
    valid_relative "$relative" || continue
    new_has_relative "$client" "$relative" && continue
    target=$(target_for "$client" "$relative")
    [ -e "$target" ] || continue

    if [ -n "$old_hash" ] && [ -f "$target" ]; then
      # hash付きmanifestに掲載された廃止ファイルは、内容が利用者により
      # 変更されていても旧キット所有。変更版も事前バックアップ済みなので
      # liveから除去して標準状態へ収束させる。
      rm -f "$target"
      continue
    fi

    if [ -f "$target" ]; then
      rm -f "$target"
    elif [ -d "$target" ]; then
      if new_has_prefix "$client" "$relative"; then
        # 現役skillは上書き対象の配布ファイルだけを更新し、knowledge等は残す。
        echo "[保持] 現役スキル内の追加ファイル: $target"
      else
        # v1 manifestが所有していた廃止skill。ディレクトリ全体は事前に
        # 検証済みバックアップ済みなので、liveから安全に整理できる。
        rm -rf "$target"
      fi
    fi
  done < "$manifest"
}

clean_stale C "$CLAUDE_MANIFEST"
clean_stale X "$CODEX_MANIFEST"

# --- ステップ 5/6: ファイル単位コピー ----------------------------
echo "Claude Code と Codex へファイルをコピーしています..."
while IFS='|' read -r client source relative; do
  target=$(target_for "$client" "$relative")
  mkdir -p "$(dirname "$target")"
  cp -p "$source" "$target"
done < "$WORK_DIR/maps"

# --- ステップ 6/6: 内容・形式検証とmanifestの原子的更新 -----------
while IFS='|' read -r client source relative; do
  target=$(target_for "$client" "$relative")
  if [ ! -f "$target" ] || ! cmp -s "$source" "$target"; then
    echo "[エラー] コピー元と配布先が一致しません: $target"
    false
  fi
done < "$WORK_DIR/maps"

install_record() {
  source="$1"
  target="$2"
  mkdir -p "$(dirname "$target")"
  cp -p "$source" "$target.new.$$"
  cmp -s "$source" "$target.new.$$"
  mv -f "$target.new.$$" "$target"
  cmp -s "$source" "$target"
}

printf '%s\n' "$KIT_VERSION" > "$WORK_DIR/version"
install_record "$WORK_DIR/claude.manifest" "$CLAUDE_MANIFEST"
install_record "$WORK_DIR/codex.manifest" "$CODEX_MANIFEST"
install_record "$WORK_DIR/version" "$CLAUDE_VERSION_FILE"
install_record "$WORK_DIR/version" "$CODEX_VERSION_FILE"

# コピー後のSKILL/TOML形式も、同じ内容であることに加えて再確認する。
while IFS= read -r name; do
  validate_target=$(target_for X "skills/$name/SKILL.md")
  awk 'NR==1 && $0=="---" { ok=1 } END { exit !ok }' "$validate_target"
done < "$WORK_DIR/skill-names"
for toml in codex/agents/*.toml; do
  [ -f "$toml" ] || continue
  cmp -s "$toml" "$CODEX_DIR/agents/$(basename "$toml")"
done

CLAUDE_SKILLS=$(find skills -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
CODEX_COMMAND_SKILLS=$(find codex/skills -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
CODEX_SKILLS=$((CLAUDE_SKILLS + CODEX_COMMAND_SKILLS + 1))
CLAUDE_AGENTS=$(find agents -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' ')
CLAUDE_COMMANDS=$(find commands -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' ')
CODEX_AGENTS=$(find codex/agents -maxdepth 1 -type f -name '*.toml' | wc -l | tr -d ' ')
LEGACY_PROMPT_COUNT=0
if [ "$LEGACY_PROMPTS" -eq 1 ]; then
  LEGACY_PROMPT_COUNT=$(find codex/prompts -maxdepth 1 -type f -name '*.md' | wc -l | tr -d ' ')
fi

TRANSACTION_ACTIVE=0
echo ""
echo "==============================================="
echo "  両方へのインストールが完了しました！"
echo "==============================================="
echo ""
echo "  Claude Code: スキル ${CLAUDE_SKILLS}個 / エージェント${CLAUDE_AGENTS}個 / コマンド${CLAUDE_COMMANDS}個"
echo "  OpenAI Codex: スキル ${CODEX_SKILLS}個 / カスタムエージェント${CODEX_AGENTS}個"
if [ "$LEGACY_PROMPTS" -eq 1 ]; then
  echo "  Codex legacy prompts: ${LEGACY_PROMPT_COUNT}個"
fi
echo ""
echo "次にやること:"
echo "  1. Claude Code と Codex を終了して起動し直す"
echo "  2. Claude Code: /build-app 作りたいものの説明"
echo "  3. Codex: \$build-app 作りたいものの説明"
finish 0
