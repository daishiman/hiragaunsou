#!/bin/bash
# AIDDキットの編集元、project配置、manifest、Codex契約を双方向に検証する。

set -Eeuo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
PROJECT_ROOT=${AIDD_PROJECT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd -P)}
STRICT=0

case "${1:-}" in
  "") ;;
  --strict) STRICT=1 ;;
  *) echo "使い方: $0 [--strict]" >&2; exit 2 ;;
esac

fail() {
  echo "[NG] $*" >&2
  exit 1
}

verify_tree() {
  source_root="$1"
  target_root="$2"
  label="$3"

  while IFS= read -r source; do
    relative=${source#"$source_root"/}
    target="$target_root/$relative"
    [ -f "$target" ] || fail "$label がありません: $target"
    cmp -s "$source" "$target" || fail "$label が編集元と一致しません: $target"
  done < <(find "$source_root" -type f -print | LC_ALL=C sort)
}

command -v python3 >/dev/null 2>&1 || fail "検証に必要な python3 がありません"
[ ! -e "$PROJECT_ROOT/.codex/skills" ] || \
  fail "project .codex/skills はAIDD Skillの配布先ではありません: $PROJECT_ROOT/.codex/skills"

verify_tree "$SCRIPT_DIR/skills" "$PROJECT_ROOT/.agents/skills" "Codex共通Skill"
verify_tree "$SCRIPT_DIR/codex/workflow-skills" "$PROJECT_ROOT/.agents/skills" "CodexワークフローSkill"
verify_tree "$SCRIPT_DIR/codex/agents" "$PROJECT_ROOT/.codex/agents" "Codex custom agent TOML"

cmp -s \
  "$SCRIPT_DIR/agents/app-orchestrator.md" \
  "$PROJECT_ROOT/.agents/skills/app-orchestrator/SKILL.md" || \
  fail "app-orchestrator Skillが編集元と一致しません"

cmp -s \
  "$SCRIPT_DIR/codex/app-orchestrator-openai.yaml" \
  "$PROJECT_ROOT/.agents/skills/app-orchestrator/agents/openai.yaml" || \
  fail "app-orchestratorのOpenAIメタデータが編集元と一致しません"

python3 - "$SCRIPT_DIR" "$PROJECT_ROOT" <<'PY'
from __future__ import annotations

from hashlib import sha256
from pathlib import Path
import re
import sys
import tomllib

kit = Path(sys.argv[1])
project = Path(sys.argv[2])
required = {"name", "description", "developer_instructions"}


def validate_agent(data: dict[str, object], label: str) -> None:
    if not required.issubset(data):
        missing = ", ".join(sorted(required - set(data)))
        raise SystemExit(f"[NG] custom agent TOMLの必須キーが足りません: {label} ({missing})")
    if not re.fullmatch(r"[a-z][a-z0-9_]*", data["name"] if isinstance(data["name"], str) else ""):
        raise SystemExit(f"[NG] custom agent名が不正です: {label}")
    if any(not isinstance(data[key], str) or not data[key].strip() for key in required):
        raise SystemExit(f"[NG] custom agent TOMLに空の必須値があります: {label}")


# 公式で許可される追加config key/tableを検証器が拒否しないことを契約化する。
fixture = tomllib.loads('''
name = "fixture_agent"
description = "fixture"
developer_instructions = "fixture"
model = "gpt-5"
model_reasoning_effort = "high"
sandbox_mode = "workspace-write"
[mcp_servers.fixture]
command = "true"
[[skills.config]]
path = ".agents/skills/fixture"
enabled = true
''')
validate_agent(fixture, "optional-config contract fixture")

seen_skill_names: dict[str, Path] = {}
skill_roots = [kit / "skills", kit / "codex" / "workflow-skills"]
skill_files: list[tuple[Path, str]] = []
for root in skill_roots:
    for directory in sorted(path for path in root.iterdir() if path.is_dir()):
        file = directory / "SKILL.md"
        if not file.is_file():
            raise SystemExit(f"[NG] SKILL.mdがありません: {file}")
        skill_files.append((file, directory.name))
skill_files.append((kit / "agents" / "app-orchestrator.md", "app-orchestrator"))

for file, expected_name in skill_files:
    lines = file.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != "---":
        raise SystemExit(f"[NG] Skill frontmatterが不正です: {file}")
    try:
        end = lines.index("---", 1)
    except ValueError:
        raise SystemExit(f"[NG] Skill frontmatterが閉じていません: {file}") from None
    frontmatter = lines[1:end]
    name_match = next((re.fullmatch(r"name:\s*(\S+)\s*", line) for line in frontmatter if line.startswith("name:")), None)
    description_index = next((index for index, line in enumerate(frontmatter) if line.startswith("description:")), -1)
    description = frontmatter[description_index].split(":", 1)[1].strip() if description_index >= 0 else ""
    description_ok = bool(description)
    if re.fullmatch(r"[>|][0-9+-]*", description):
        description_ok = any(
            re.match(r"\s+\S", line)
            for line in frontmatter[description_index + 1 :]
        )
    if name_match is None or name_match.group(1) != expected_name or not description_ok:
        raise SystemExit(f"[NG] Skill名またはdescriptionが不正です: {file}")
    if expected_name in seen_skill_names:
        raise SystemExit(f"[NG] キット内でSkill名が重複しています: {expected_name}")
    seen_skill_names[expected_name] = file

for source in sorted((kit / "codex" / "agents").glob("*.toml")):
    with source.open("rb") as stream:
        validate_agent(tomllib.load(stream), str(source))

orchestrator = (kit / "agents" / "app-orchestrator.md").read_text(encoding="utf-8")
metadata = (kit / "codex" / "app-orchestrator-openai.yaml").read_text(encoding="utf-8")
if "MUST BE USED PROACTIVELY" in orchestrator:
    raise SystemExit("[NG] app-orchestratorはimplicit禁止なのにproactive起動を要求しています")
if not re.search(r"(?m)^\s*allow_implicit_invocation:\s*false\s*$", metadata):
    raise SystemExit("[NG] app-orchestratorのimplicit起動ポリシーが不正です")

mapping: dict[str, Path] = {}


def add_tree(source_root: Path, relative_root: str) -> None:
    for source in sorted(path for path in source_root.rglob("*") if path.is_file()):
        add(source, f"{relative_root}/{source.relative_to(source_root).as_posix()}")


def add(source: Path, relative: str) -> None:
    if relative in mapping:
        raise SystemExit(f"[NG] Codex manifestの配布先が重複しています: {relative}")
    mapping[relative] = source


add_tree(kit / "skills", "skills")
add_tree(kit / "codex" / "workflow-skills", "skills")
add(kit / "agents" / "app-orchestrator.md", "skills/app-orchestrator/SKILL.md")
add(kit / "codex" / "app-orchestrator-openai.yaml", "skills/app-orchestrator/agents/openai.yaml")
add_tree(kit / "codex" / "agents", "agents")

expected = {relative: sha256(source.read_bytes()).hexdigest() for relative, source in mapping.items()}
manifest_path = project / ".codex" / "aidd-agent-kit.manifest"
actual: dict[str, str] = {}
for line in manifest_path.read_text(encoding="utf-8").splitlines():
    digest, separator, relative = line.partition("|")
    if not separator or not re.fullmatch(r"[0-9a-f]{64}", digest) or not relative or relative in actual:
        raise SystemExit(f"[NG] Codex manifestの形式が不正です: {manifest_path}")
    actual[relative] = digest

if actual != expected:
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    mismatch = sorted(key for key in set(actual) & set(expected) if actual[key] != expected[key])
    raise SystemExit(
        "[NG] Codex manifestが編集元と一致しません"
        f" (missing={len(missing)}, extra={len(extra)}, hash_mismatch={len(mismatch)})"
    )

for relative, digest in expected.items():
    if relative.startswith("skills/"):
        target = project / ".agents" / "skills" / relative.removeprefix("skills/")
    else:
        target = project / ".codex" / relative
    if not target.is_file() or sha256(target.read_bytes()).hexdigest() != digest:
        raise SystemExit(f"[NG] manifestの配布先hashが一致しません: {target}")
PY

kit_version=$(awk -F'"' '/^KIT_VERSION=/{ print $2; exit }' "$SCRIPT_DIR/install-mac.command")
[ -n "$kit_version" ] || fail "キットのバージョンを取得できません"

for version_file in \
  "$PROJECT_ROOT/.claude/aidd-agent-kit.version" \
  "$PROJECT_ROOT/.codex/aidd-agent-kit.version"; do
  [ -f "$version_file" ] || fail "反映バージョンがありません: $version_file"
  actual=$(tr -d '\r\n' < "$version_file")
  [ "$actual" = "$kit_version" ] || \
    fail "反映バージョンがキットと一致しません: $version_file ($actual != $kit_version)"
done

if [ "$STRICT" -eq 1 ]; then
  AIDD_PROJECT_ROOT="$PROJECT_ROOT" "$SCRIPT_DIR/doctor-codex-layout.sh" --strict
fi

echo "[OK] Codex skills: $PROJECT_ROOT/.agents/skills"
echo "[OK] Codex custom agents (.toml): $PROJECT_ROOT/.codex/agents"
echo "[OK] Codex manifest: path/hash完全一致"
echo "[OK] custom agent TOML: 必須3キー + 追加configを許容"
echo "[OK] project .codex/skills: AIDD配布先として未使用"
echo "[OK] AIDD kit version: $kit_version"
