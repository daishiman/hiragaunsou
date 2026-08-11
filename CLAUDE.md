# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 現在のリポジトリ状態

このリポジトリはまだ空です。2026-07-26 時点で確認できる事実は以下のみです。

- 追跡ファイルは `README.md` の 1 件のみ (内容は `# hiragaunsou` の 1 行)
- コミットは `9929f61 first commit` の 1 件のみ、ブランチは `main`
- リモート: `git@github.com:daishiman/hiragaunsou.git`
- ソースコード、パッケージマネージャ設定、ビルド/テスト/lint の設定ファイルは一切存在しない

したがって **ビルド・テスト・lint の実行コマンドは未定義** であり、記述できるアーキテクチャも存在しません。

## このファイルの扱い

上記は実装開始とともに即座に陳腐化します。ソースコードやツールチェーンが追加された時点で `/init` を再実行し、この内容を実物に基づく記述で上書きしてください。特に以下が確定した段階で書き換えが必要です。

- パッケージマネージャとビルド/テスト/lint コマンド (単一テストの実行方法を含む)
- ディレクトリ構成と、複数ファイルを読まないと掴めない全体アーキテクチャ

存在しないコマンドや推測した技術スタックをこのファイルに記載しないでください。CLAUDE.md は全セッションで自動的に読み込まれるため、誤った記述は継続的に影響します。


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
