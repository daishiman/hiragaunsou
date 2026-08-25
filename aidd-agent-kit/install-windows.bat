@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title AI開発エージェントキット インストーラー (Windows)
cd /d "%~dp0"

if not exist "%~dp0VERSION" (
  echo [エラー] VERSION が見つかりません。
  exit /b 1
)
set /p KIT_VERSION=<"%~dp0VERSION"
if not defined KIT_VERSION (
  echo [エラー] VERSION が空です。
  exit /b 1
)
if defined AIDD_TARGET_HOME (
  set "INSTALL_HOME=%AIDD_TARGET_HOME%"
) else (
  set "INSTALL_HOME=%USERPROFILE%"
)
set "CLAUDE_DIR=%INSTALL_HOME%\.claude"
if defined AIDD_CODEX_TARGET (
  set "CODEX_DIR=%AIDD_CODEX_TARGET%"
) else if defined CODEX_HOME (
  set "CODEX_DIR=%CODEX_HOME%"
) else (
  set "CODEX_DIR=%USERPROFILE%\.codex"
)
set "CODEX_SKILLS_DIR=%INSTALL_HOME%\.agents\skills"
set "CLAUDE_MANIFEST=%CLAUDE_DIR%\aidd-agent-kit.manifest"
set "CLAUDE_VERSION_FILE=%CLAUDE_DIR%\aidd-agent-kit.version"
set "CODEX_MANIFEST=%CODEX_DIR%\aidd-agent-kit.manifest"
set "CODEX_VERSION_FILE=%CODEX_DIR%\aidd-agent-kit.version"
set "LEGACY_PROMPTS=0"
set "TRANSACTION_ACTIVE=0"

:ARG_LOOP
if "%~1"=="" goto ARGS_DONE
if /i "%~1"=="--legacy-prompts" (
  set "LEGACY_PROMPTS=1"
) else (
  echo [エラー] 未対応のオプションです: %~1
  echo 使用可能: --legacy-prompts
  goto ERR_END
)
shift
goto ARG_LOOP

:ARGS_DONE
set "STAMP="
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss" 2^>nul') do set "STAMP=%%i"
if not defined STAMP set "STAMP=old"
set "CLAUDE_BACKUP_DIR=%CLAUDE_DIR%\backup-%STAMP%"
set "CODEX_BACKUP_DIR=%CODEX_DIR%\backup-%STAMP%"
set "WORK_DIR=%TEMP%\aidd-agent-kit-%STAMP%-%RANDOM%"
set "CLAUDE_NEW_MANIFEST=%WORK_DIR%\claude.manifest"
set "CODEX_NEW_MANIFEST=%WORK_DIR%\codex.manifest"
set "AFFECTED=%WORK_DIR%\affected.txt"
set "TARGET_LIST=%WORK_DIR%\targets.txt"
set "DIR_TARGET_LIST=%WORK_DIR%\directory-targets.txt"
set "SOURCE_MAP=%WORK_DIR%\source-map.txt"

echo.
echo ===============================================
echo   AI開発エージェントキット インストーラー
echo   Claude Code + OpenAI Codex / %KIT_VERSION%
echo ===============================================
echo.

rem --- ステップ 1/6: コピー元と形式の事前検証 ----------------------
set "AIDD_PHASE=source-files"
if not exist "skills" goto ERR_SRC
if not exist "agents" goto ERR_SRC
if not exist "commands" goto ERR_SRC
if not exist "codex\workflow-skills" goto ERR_SRC
if not exist "codex\agents" goto ERR_SRC
if not exist "agents\app-orchestrator.md" goto ERR_SRC
if not exist "codex\app-orchestrator-openai.yaml" goto ERR_SRC
if not exist "scripts\preflight-windows.ps1" goto ERR_SRC
if "%LEGACY_PROMPTS%"=="1" if not exist "codex\prompts" goto ERR_SRC

if exist "%WORK_DIR%" goto ERR_TEMP
mkdir "%WORK_DIR%" || goto ERR_TEMP
type nul > "%AFFECTED%"
type nul > "%TARGET_LIST%"
type nul > "%DIR_TARGET_LIST%"
type nul > "%SOURCE_MAP%"
set "KIT_ROOT=%CD%"


rem SKILL frontmatter名・配布先名・重複、TOML必須フィールド、
rem コピー元reparse pointを1回のPowerShell走査で検証する。
rem TOMLは必須の文字列3項目だけを確認し、公式configの追加キーやtableは許容する。
set "AIDD_PHASE=source-preflight"
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%KIT_ROOT%\scripts\preflight-windows.ps1" -KitRoot "%KIT_ROOT%" -LegacyPrompts "%LEGACY_PROMPTS%"
if errorlevel 1 goto ERR_FORMAT

rem 旧manifestをコマンドとして解釈させないため、読み込み前に安全な文字・形式へ限定する。
set "AIDD_PHASE=old-manifest"
set "OLD_CLAUDE_MANIFEST=%CLAUDE_MANIFEST%"
set "OLD_CODEX_MANIFEST=%CODEX_MANIFEST%"
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; foreach($path in @($env:OLD_CLAUDE_MANIFEST,$env:OLD_CODEX_MANIFEST)){if(-not (Test-Path -LiteralPath $path -PathType Leaf)){continue}; foreach($line in Get-Content -LiteralPath $path){if([string]::IsNullOrWhiteSpace($line)){continue}; $p=$line.Split('|',2); if($p.Count -eq 2 -and $p[0] -notmatch '^[0-9a-fA-F]{64}$'){throw ('invalid manifest hash: '+$path)}; $rel=$p[$p.Count-1]; if($rel -notmatch '^[A-Za-z0-9_.\\-]+$' -or $rel -match '(^|\\)\.\.?($|\\)' -or $rel -notmatch '^(skills|agents|commands|prompts)\\'){throw ('unsafe manifest path: '+$path)}}}" >nul 2>&1
if errorlevel 1 goto ERR_FORMAT

set "AIDD_PHASE=map-claude-skills"
call :MAP_TREE C "skills" "skills" || goto ERR_FORMAT
set "AIDD_PHASE=map-claude-agents"
call :MAP_TREE C "agents" "agents" || goto ERR_FORMAT
set "AIDD_PHASE=map-claude-commands"
call :MAP_TREE C "commands" "commands" || goto ERR_FORMAT
set "AIDD_PHASE=map-codex-common-skills"
call :MAP_TREE X "skills" "skills" || goto ERR_FORMAT
set "AIDD_PHASE=map-codex-workflow-skills"
call :MAP_TREE X "codex\workflow-skills" "skills" || goto ERR_FORMAT
set "AIDD_PHASE=map-codex-orchestrator-skill"
call :MAP_FILE X "agents\app-orchestrator.md" "skills\app-orchestrator\SKILL.md" || goto ERR_FORMAT
set "AIDD_PHASE=map-codex-orchestrator-metadata"
call :MAP_FILE X "codex\app-orchestrator-openai.yaml" "skills\app-orchestrator\agents\openai.yaml" || goto ERR_FORMAT
set "AIDD_PHASE=map-codex-custom-agents"
call :MAP_TREE X "codex\agents" "agents" || goto ERR_FORMAT
if "%LEGACY_PROMPTS%"=="1" (
  set "AIDD_PHASE=map-codex-legacy-prompts"
  call :MAP_TREE X "codex\prompts" "prompts"
  if errorlevel 1 goto ERR_FORMAT
)

set "CL_NEW=%CLAUDE_NEW_MANIFEST%"
set "CX_NEW=%CODEX_NEW_MANIFEST%"
set "AIDD_PHASE=build-manifests"
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $cache=@{}; $claude=New-Object Collections.Generic.List[string]; $codex=New-Object Collections.Generic.List[string]; foreach($line in Get-Content -LiteralPath $env:SOURCE_MAP -Encoding UTF8){$p=$line.Split('|',3); if($p.Count -ne 3){throw 'invalid source map'}; if(-not $cache.ContainsKey($p[1])){$cache[$p[1]]=(Get-FileHash -LiteralPath $p[1] -Algorithm SHA256).Hash.ToLowerInvariant()}; $entry=$cache[$p[1]]+'|'+$p[2]; if($p[0] -eq 'C'){$claude.Add($entry)}else{$codex.Add($entry)}}; $claude=$claude.ToArray() | Sort-Object -Unique; $codex=$codex.ToArray() | Sort-Object -Unique; [IO.File]::WriteAllLines($env:CL_NEW,$claude,(New-Object Text.UTF8Encoding($false))); [IO.File]::WriteAllLines($env:CX_NEW,$codex,(New-Object Text.UTF8Encoding($false)))" >nul 2>&1
if errorlevel 1 goto ERR_FORMAT
echo %KIT_VERSION%> "%WORK_DIR%\version"

rem 全配布先・manifest・versionが既に完全一致する場合は、
rem 変更対象の登録やbackupより前に無更新で終了する。
call :CHECK_NO_CHANGES
if not errorlevel 1 goto NO_CHANGES

rem 新旧manifestが示す「実際に変更するファイル」だけを登録する。
set "AIDD_PHASE=register-claude-manifest"
for /f "usebackq delims=" %%L in ("%CLAUDE_NEW_MANIFEST%") do (
  call :REGISTER_MANIFEST_ENTRY C "%%L"
  if errorlevel 1 goto ERR_FORMAT
)
set "AIDD_PHASE=register-codex-manifest"
for /f "usebackq delims=" %%L in ("%CODEX_NEW_MANIFEST%") do (
  call :REGISTER_MANIFEST_ENTRY X "%%L"
  if errorlevel 1 goto ERR_FORMAT
)
if exist "%CLAUDE_MANIFEST%" for /f "usebackq delims=" %%L in ("%CLAUDE_MANIFEST%") do (
  call :REGISTER_OLD_ENTRY C "%%L"
  if errorlevel 1 goto ERR_FORMAT
)
if exist "%CODEX_MANIFEST%" for /f "usebackq delims=" %%L in ("%CODEX_MANIFEST%") do (
  call :REGISTER_OLD_ENTRY X "%%L"
  if errorlevel 1 goto ERR_FORMAT
)
set "AIDD_PHASE=register-control-files"
call :REGISTER_REL C "aidd-agent-kit.manifest" || goto ERR_FORMAT
call :REGISTER_REL C "aidd-agent-kit.version" || goto ERR_FORMAT
call :REGISTER_REL X "aidd-agent-kit.manifest" || goto ERR_FORMAT
call :REGISTER_REL X "aidd-agent-kit.version" || goto ERR_FORMAT

rem --- ステップ 2/6: 上書き対象と全祖先のreparse安全確認 ---------
echo Claude Code: %CLAUDE_DIR%
echo Codex skills: %CODEX_SKILLS_DIR%
echo Codex custom agents: %CODEX_DIR%\agents
if "%LEGACY_PROMPTS%"=="1" echo Codex legacy prompts: 有効
echo.

if exist "%CODEX_DIR%\skills\NUL" (
  echo [注意] %CODEX_DIR%\skills はAIDDキットの配布先ではありません。
  echo   AIDDキットのスキル配布先: %CODEX_SKILLS_DIR%
  echo   Codex組込installer等が管理するpersonal領域の可能性があるため、既存ファイルは変更しません。
  echo.
)

for /f "usebackq tokens=1,2,3 delims=|" %%A in ("%AFFECTED%") do call :ADD_TARGET %%A "%%B" %%C
>> "%TARGET_LIST%" echo(%CLAUDE_BACKUP_DIR%
>> "%TARGET_LIST%" echo(%CODEX_BACKUP_DIR%
set "CHECK_LIST=%TARGET_LIST%"
set "CHECK_DIR_LIST=%DIR_TARGET_LIST%"
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; foreach($raw in Get-Content -LiteralPath $env:CHECK_LIST){$p=[IO.Path]::GetFullPath($raw); while($p){$i=Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue; if($null -ne $i -and (($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw ('destination reparse point: '+$p)}; $parent=[IO.Directory]::GetParent($p); if($null -eq $parent){break}; $next=$parent.FullName; if($next -eq $p){break}; $p=$next}}; foreach($root in Get-Content -LiteralPath $env:CHECK_DIR_LIST){if(-not (Test-Path -LiteralPath $root -PathType Container)){continue}; foreach($i in Get-ChildItem -LiteralPath $root -Recurse -Force){if(($i.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw ('destination child reparse point: '+$i.FullName)}}}" >nul 2>&1
if errorlevel 1 goto ERR_SYMLINK

rem --- ステップ 3/6: 変更対象を検証付きでバックアップ ------------
for /f "usebackq tokens=1,2,3 delims=|" %%A in ("%AFFECTED%") do (
  call :BACKUP_ITEM %%A "%%B" %%C
  if errorlevel 1 goto ERR_BACKUP
)
set "TRANSACTION_ACTIVE=1"
if exist "%CLAUDE_BACKUP_DIR%" echo Claude Code の変更対象を検証付きでバックアップしました: %CLAUDE_BACKUP_DIR%
if exist "%CODEX_BACKUP_DIR%" echo Codex の変更対象を検証付きでバックアップしました: %CODEX_BACKUP_DIR%

call :MAKE_DIR "%CLAUDE_DIR%\skills" || goto ERR_COPY
call :MAKE_DIR "%CLAUDE_DIR%\agents" || goto ERR_COPY
call :MAKE_DIR "%CLAUDE_DIR%\commands" || goto ERR_COPY
call :MAKE_DIR "%CODEX_SKILLS_DIR%" || goto ERR_COPY
call :MAKE_DIR "%CODEX_DIR%\agents" || goto ERR_COPY
if "%LEGACY_PROMPTS%"=="1" (
  call :MAKE_DIR "%CODEX_DIR%\prompts"
  if errorlevel 1 goto ERR_COPY
)

rem --- ステップ 4/6: 旧manifest所有ファイルの整理 ---------------
if exist "%CLAUDE_MANIFEST%" for /f "usebackq delims=" %%L in ("%CLAUDE_MANIFEST%") do (
  call :CLEAN_STALE_ENTRY C "%%L" "%CLAUDE_NEW_MANIFEST%"
  if errorlevel 1 goto ERR_STALE
)
if exist "%CODEX_MANIFEST%" for /f "usebackq delims=" %%L in ("%CODEX_MANIFEST%") do (
  call :CLEAN_STALE_ENTRY X "%%L" "%CODEX_NEW_MANIFEST%"
  if errorlevel 1 goto ERR_STALE
)

rem --- ステップ 5/6: Claude Code と Codex へコピー --------------
echo (1/6) Claude Code のスキルをコピーしています...
xcopy "skills" "%CLAUDE_DIR%\skills\" /E /I /Y /Q /H >nul
if errorlevel 1 goto ERR_COPY
echo (2/6) Claude Code のエージェントをコピーしています...
xcopy "agents" "%CLAUDE_DIR%\agents\" /E /I /Y /Q /H >nul
if errorlevel 1 goto ERR_COPY
echo (3/6) Claude Code のコマンドをコピーしています...
xcopy "commands" "%CLAUDE_DIR%\commands\" /E /I /Y /Q /H >nul
if errorlevel 1 goto ERR_COPY
echo (4/6) Codex のスキルをコピーしています...
xcopy "skills" "%CODEX_SKILLS_DIR%\" /E /I /Y /Q /H >nul
if errorlevel 1 goto ERR_COPY
xcopy "codex\workflow-skills" "%CODEX_SKILLS_DIR%\" /E /I /Y /Q /H >nul
if errorlevel 1 goto ERR_COPY
call :MAKE_DIR "%CODEX_SKILLS_DIR%\app-orchestrator\agents" || goto ERR_COPY
copy /Y "agents\app-orchestrator.md" "%CODEX_SKILLS_DIR%\app-orchestrator\SKILL.md" >nul
if errorlevel 1 goto ERR_COPY
copy /Y "codex\app-orchestrator-openai.yaml" "%CODEX_SKILLS_DIR%\app-orchestrator\agents\openai.yaml" >nul
if errorlevel 1 goto ERR_COPY
echo (5/6) Codex のカスタムエージェントをコピーしています...
xcopy "codex\agents" "%CODEX_DIR%\agents\" /E /I /Y /Q /H >nul
if errorlevel 1 goto ERR_COPY
if "%LEGACY_PROMPTS%"=="1" (
  echo ^(6/6^) Codex のlegacy promptsをコピーしています...
  xcopy "codex\prompts" "%CODEX_DIR%\prompts\" /E /I /Y /Q /H >nul
  if errorlevel 1 goto ERR_COPY
) else (
  echo ^(6/6^) Codex のコマンドはスキルとして導入済みです。
)
echo.

rem --- ステップ 6/6: 内容検証とmanifestの更新 --------------------
call :VERIFY_TREE "skills" C "skills" || goto ERR_VERIFY
call :VERIFY_TREE "agents" C "agents" || goto ERR_VERIFY
call :VERIFY_TREE "commands" C "commands" || goto ERR_VERIFY
call :VERIFY_TREE "skills" X "skills" || goto ERR_VERIFY
call :VERIFY_TREE "codex\workflow-skills" X "skills" || goto ERR_VERIFY
call :VERIFY_FILE "agents\app-orchestrator.md" X "skills\app-orchestrator\SKILL.md" || goto ERR_VERIFY
call :VERIFY_FILE "codex\app-orchestrator-openai.yaml" X "skills\app-orchestrator\agents\openai.yaml" || goto ERR_VERIFY
call :VERIFY_TREE "codex\agents" X "agents" || goto ERR_VERIFY
if "%LEGACY_PROMPTS%"=="1" (
  call :VERIFY_TREE "codex\prompts" X "prompts"
  if errorlevel 1 goto ERR_VERIFY
)

call :INSTALL_RECORD "%CLAUDE_NEW_MANIFEST%" "%CLAUDE_MANIFEST%" || goto ERR_VERIFY
call :INSTALL_RECORD "%CODEX_NEW_MANIFEST%" "%CODEX_MANIFEST%" || goto ERR_VERIFY
call :INSTALL_RECORD "%WORK_DIR%\version" "%CLAUDE_VERSION_FILE%" || goto ERR_VERIFY
call :INSTALL_RECORD "%WORK_DIR%\version" "%CODEX_VERSION_FILE%" || goto ERR_VERIFY

set /a CLAUDE_SKILLS=0
set /a CODEX_COMMAND_SKILLS=0
set /a CLAUDE_AGENTS=0
set /a CLAUDE_COMMANDS=0
set /a CODEX_AGENTS=0
set /a LEGACY_PROMPT_COUNT=0
for /d %%D in (skills\*) do set /a CLAUDE_SKILLS+=1
for /d %%D in (codex\workflow-skills\*) do set /a CODEX_COMMAND_SKILLS+=1
for %%F in (agents\*.md) do set /a CLAUDE_AGENTS+=1
for %%F in (commands\*.md) do set /a CLAUDE_COMMANDS+=1
for %%F in (codex\agents\*.toml) do set /a CODEX_AGENTS+=1
if "%LEGACY_PROMPTS%"=="1" for %%F in (codex\prompts\*.md) do set /a LEGACY_PROMPT_COUNT+=1
set /a CODEX_SKILLS=CLAUDE_SKILLS+CODEX_COMMAND_SKILLS+1
set "TRANSACTION_ACTIVE=0"

echo ===============================================
echo   両方へのインストールが完了しました！
echo ===============================================
echo.
echo   Claude Code: スキル !CLAUDE_SKILLS!個 / エージェント!CLAUDE_AGENTS!個 / コマンド!CLAUDE_COMMANDS!個
echo   OpenAI Codex: スキル !CODEX_SKILLS!個 / カスタムエージェント!CODEX_AGENTS!個
if "%LEGACY_PROMPTS%"=="1" echo   Codex legacy prompts: !LEGACY_PROMPT_COUNT!個
echo.
echo 配置先:
echo   Codex skills: %CODEX_SKILLS_DIR%
echo   Codex custom agents ^(.toml^): %CODEX_DIR%\agents
echo   ※ .codex\skills はAIDDキットの配布先ではありません。Codex組込installer等のpersonal領域は変更しません。
echo.
echo 次にやること:
echo   1. Claude Code と Codex を終了して起動し直す
echo   2. Claude Code: /build-app 作りたいものの説明
echo   3. Codex: $build-app 作りたいものの説明
echo.
call :CLEAN_WORK
if not "%AIDD_NONINTERACTIVE%"=="1" pause
exit /b 0

:NO_CHANGES
echo [OK] AIDDエージェントキット: 変更なし
call :CLEAN_WORK
if not "%AIDD_NONINTERACTIVE%"=="1" pause
exit /b 0

rem =============================================================
rem  サブルーチン
rem =============================================================
:CHECK_NO_CHANGES
set "NO_CHANGES=1"
for /f "usebackq tokens=1,2,3 delims=|" %%A in ("%SOURCE_MAP%") do call :COMPARE_MAP_ENTRY %%A "%%B" "%%C"
if not exist "%CLAUDE_MANIFEST%" set "NO_CHANGES=0"
if not exist "%CODEX_MANIFEST%" set "NO_CHANGES=0"
if not exist "%CLAUDE_VERSION_FILE%" set "NO_CHANGES=0"
if not exist "%CODEX_VERSION_FILE%" set "NO_CHANGES=0"
if "!NO_CHANGES!"=="1" (
  fc /b "%CLAUDE_NEW_MANIFEST%" "%CLAUDE_MANIFEST%" >nul 2>&1 || set "NO_CHANGES=0"
)
if "!NO_CHANGES!"=="1" (
  fc /b "%CODEX_NEW_MANIFEST%" "%CODEX_MANIFEST%" >nul 2>&1 || set "NO_CHANGES=0"
)
if "!NO_CHANGES!"=="1" (
  fc /b "%WORK_DIR%\version" "%CLAUDE_VERSION_FILE%" >nul 2>&1 || set "NO_CHANGES=0"
)
if "!NO_CHANGES!"=="1" (
  fc /b "%WORK_DIR%\version" "%CODEX_VERSION_FILE%" >nul 2>&1 || set "NO_CHANGES=0"
)
if "!NO_CHANGES!"=="1" exit /b 0
exit /b 1

:COMPARE_MAP_ENTRY
if "!NO_CHANGES!"=="0" exit /b 0
call :TARGET_FOR %~1 "%~3"
if not exist "!TARGET!" (
  set "NO_CHANGES=0"
  exit /b 0
)
if exist "!TARGET!\NUL" (
  set "NO_CHANGES=0"
  exit /b 0
)
fc /b "%~2" "!TARGET!" >nul 2>&1 || set "NO_CHANGES=0"
exit /b 0

:MAP_TREE
for /r "%~f2" %%F in (*) do (
  call :MAP_TREE_FILE %~1 "%%~fF" "%~f2" "%~3"
  if errorlevel 1 exit /b 1
)
exit /b 0

:MAP_TREE_FILE
set "TREE_FILE=%~f2"
set "TREE_ROOT=%~f3"
set "TREE_SUFFIX=!TREE_FILE:%TREE_ROOT%\=!"
call :MAP_FILE %~1 "%~f2" "%~4\!TREE_SUFFIX!"
exit /b %errorlevel%

:MAP_FILE
set "MAP_SOURCE=%~f2"
>> "%SOURCE_MAP%" echo(%~1^|!MAP_SOURCE!^|%~3
if errorlevel 1 exit /b 1
exit /b 0

:GET_HASH
set "HASH_PATH=%~f1"
set "FILE_HASH="
for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "(Get-FileHash -LiteralPath $env:HASH_PATH -Algorithm SHA256).Hash.ToLowerInvariant()" 2^>nul`) do set "FILE_HASH=%%H"
if not defined FILE_HASH exit /b 1
exit /b 0

:VALID_REL
set "REL=%~1"
if not defined REL exit /b 1
echo(!REL!| findstr /l /c:".." /c:"|" /c:"/" >nul && exit /b 1
if /i "!REL:~0,7!"=="skills\" exit /b 0
if /i "!REL:~0,7!"=="agents\" exit /b 0
if /i "!REL:~0,9!"=="commands\" exit /b 0
if /i "!REL:~0,8!"=="prompts\" exit /b 0
if /i "!REL!"=="aidd-agent-kit.manifest" exit /b 0
if /i "!REL!"=="aidd-agent-kit.version" exit /b 0
exit /b 1

:REGISTER_MANIFEST_ENTRY
set "ENTRY_REL="
for /f "tokens=1,* delims=|" %%H in ("%~2") do set "ENTRY_REL=%%I"
if not defined ENTRY_REL exit /b 1
call :REGISTER_REL %~1 "!ENTRY_REL!"
exit /b %errorlevel%

:REGISTER_OLD_ENTRY
set "OLD_LINE=%~2"
set "ENTRY_REL="
for /f "tokens=1,* delims=|" %%H in ("!OLD_LINE!") do (
  set "ENTRY_FIRST=%%H"
  set "ENTRY_REL=%%I"
)
if not defined ENTRY_REL set "ENTRY_REL=!ENTRY_FIRST!"
call :VALID_REL "!ENTRY_REL!" || exit /b 0
call :TARGET_FOR %~1 "!ENTRY_REL!"
if exist "!TARGET!\NUL" (
  if /i "%~1"=="C" (
    set "PREFIX_MANIFEST=%CLAUDE_NEW_MANIFEST%"
  ) else (
    set "PREFIX_MANIFEST=%CODEX_NEW_MANIFEST%"
  )
  findstr /l /c:"|!ENTRY_REL!\" "!PREFIX_MANIFEST!" >nul 2>&1
  if not errorlevel 1 exit /b 0
  call :REGISTER_DIR %~1 "!ENTRY_REL!"
  exit /b !errorlevel!
)
call :REGISTER_REL %~1 "!ENTRY_REL!"
exit /b %errorlevel%

:REGISTER_DIR
set "REG_CLIENT=%~1"
set "REG_REL=%~2"
call :VALID_REL "!REG_REL!" || exit /b 1
findstr /b /l /c:"!REG_CLIENT!|!REG_REL!|" "%AFFECTED%" >nul 2>&1
if not errorlevel 1 exit /b 0
call :TARGET_FOR !REG_CLIENT! "!REG_REL!"
if not exist "!TARGET!\NUL" exit /b 1
>> "%AFFECTED%" echo(!REG_CLIENT!^|!REG_REL!^|D
if errorlevel 1 exit /b 1
exit /b 0

:REGISTER_REL
set "REG_CLIENT=%~1"
set "REG_REL=%~2"
call :VALID_REL "!REG_REL!" || exit /b 1
findstr /b /l /c:"!REG_CLIENT!|!REG_REL!|" "%AFFECTED%" >nul 2>&1
if not errorlevel 1 exit /b 0
call :TARGET_FOR !REG_CLIENT! "!REG_REL!"
if exist "!TARGET!\NUL" exit /b 1
set "REG_EXISTED=0"
if exist "!TARGET!" set "REG_EXISTED=1"
>> "%AFFECTED%" echo(!REG_CLIENT!^|!REG_REL!^|!REG_EXISTED!
if errorlevel 1 exit /b 1
exit /b 0

:TARGET_FOR
set "TF_CLIENT=%~1"
set "TF_REL=%~2"
if /i "!TF_CLIENT!"=="C" (
  set "TARGET=%CLAUDE_DIR%\!TF_REL!"
) else if /i "!TF_REL:~0,7!"=="skills\" (
  set "TARGET=%CODEX_SKILLS_DIR%\!TF_REL:~7!"
) else (
  set "TARGET=%CODEX_DIR%\!TF_REL!"
)
exit /b 0

:ADD_TARGET
call :TARGET_FOR %~1 "%~2"
>> "%TARGET_LIST%" echo(!TARGET!
if /i "%~3"=="D" >> "%DIR_TARGET_LIST%" echo(!TARGET!
exit /b 0

:BACKUP_ITEM
if "%~3"=="0" exit /b 0
call :TARGET_FOR %~1 "%~2"
if /i "%~1"=="C" (
  set "BACKUP=%CLAUDE_BACKUP_DIR%\%~2"
) else (
  set "BACKUP=%CODEX_BACKUP_DIR%\%~2"
)
for %%P in ("!BACKUP!") do if not exist "%%~dpP" (
  mkdir "%%~dpP"
  if errorlevel 1 exit /b 1
)
if /i "%~3"=="D" (
  xcopy "!TARGET!" "!BACKUP!\" /E /I /Y /Q /H >nul
  if errorlevel 1 exit /b 1
  call :VERIFY_DIRECTORY "!TARGET!" "!BACKUP!"
  exit /b !errorlevel!
)
copy /Y "!TARGET!" "!BACKUP!" >nul
if errorlevel 1 exit /b 1
fc /b "!TARGET!" "!BACKUP!" >nul
if errorlevel 1 exit /b 1
exit /b 0

:MAKE_DIR
if not exist "%~1" mkdir "%~1"
if not exist "%~1" exit /b 1
exit /b 0

:VERIFY_DIRECTORY
set "VERIFY_DIR_SOURCE=%~f1"
set "VERIFY_DIR_TARGET=%~f2"
powershell -NoProfile -Command "$ErrorActionPreference='Stop'; function Snapshot([string]$root){$prefix=$root.TrimEnd('\')+'\'; @(Get-ChildItem -LiteralPath $root -Recurse -Force | ForEach-Object {$rel=$_.FullName.Substring($prefix.Length); if($_.PSIsContainer){'D|'+$rel}else{'F|'+$rel+'|'+(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}} | Sort-Object)}; $a=Snapshot $env:VERIFY_DIR_SOURCE; $b=Snapshot $env:VERIFY_DIR_TARGET; if(Compare-Object $a $b){exit 1}" >nul 2>&1
exit /b %errorlevel%

:CLEAN_STALE_ENTRY
set "CLEAN_CLIENT=%~1"
set "CLEAN_LINE=%~2"
set "CLEAN_NEW=%~3"
set "OLD_HASH="
set "CLEAN_REL="
for /f "tokens=1,* delims=|" %%H in ("!CLEAN_LINE!") do (
  set "OLD_FIRST=%%H"
  set "CLEAN_REL=%%I"
)
if defined CLEAN_REL (
  set "OLD_HASH=!OLD_FIRST!"
) else (
  set "CLEAN_REL=!OLD_FIRST!"
)
call :VALID_REL "!CLEAN_REL!" || exit /b 0
findstr /e /l /c:"|!CLEAN_REL!" "!CLEAN_NEW!" >nul 2>&1
if not errorlevel 1 exit /b 0
call :TARGET_FOR !CLEAN_CLIENT! "!CLEAN_REL!"
if not exist "!TARGET!" exit /b 0
if exist "!TARGET!\NUL" (
  findstr /l /c:"|!CLEAN_REL!\" "!CLEAN_NEW!" >nul 2>&1
  if not errorlevel 1 (
    echo [保持] 現役スキル内の追加ファイル: !TARGET!
    exit /b 0
  )
  rd /s /q "!TARGET!" >nul 2>&1
  if exist "!TARGET!" exit /b 1
  exit /b 0
)
if defined OLD_HASH (
  rem hash付き旧manifestの廃止ファイルは旧キット所有。
  rem 変更版も検証済みバックアップ済みなのでliveから除去する。
  del /q "!TARGET!" >nul 2>&1
  if exist "!TARGET!" exit /b 1
  exit /b 0
)
del /q "!TARGET!" >nul 2>&1
if exist "!TARGET!" exit /b 1
exit /b 0

:VERIFY_TREE
for /r "%~f1" %%F in (*) do (
  call :VERIFY_TREE_FILE "%%~fF" "%~f1" %~2 "%~3"
  if errorlevel 1 exit /b 1
)
exit /b 0

:VERIFY_TREE_FILE
set "VERIFY_SOURCE=%~f1"
set "VERIFY_ROOT=%~f2"
set "VERIFY_SUFFIX=!VERIFY_SOURCE:%VERIFY_ROOT%\=!"
call :VERIFY_FILE "%~f1" %~3 "%~4\!VERIFY_SUFFIX!"
exit /b %errorlevel%

:VERIFY_FILE
call :TARGET_FOR %~2 "%~3"
if not exist "!TARGET!" exit /b 1
fc /b "%~f1" "!TARGET!" >nul
if errorlevel 1 exit /b 1
exit /b 0

:INSTALL_RECORD
for %%P in ("%~2") do if not exist "%%~dpP" (
  mkdir "%%~dpP"
  if errorlevel 1 exit /b 1
)
copy /Y "%~1" "%~2.new" >nul
if errorlevel 1 exit /b 1
fc /b "%~1" "%~2.new" >nul
if errorlevel 1 exit /b 1
move /Y "%~2.new" "%~2" >nul
if errorlevel 1 exit /b 1
fc /b "%~1" "%~2" >nul
if errorlevel 1 exit /b 1
exit /b 0

:ROLLBACK
if not "%TRANSACTION_ACTIVE%"=="1" exit /b 0
echo [復元] 途中までの変更を元に戻しています...
for /f "usebackq tokens=1,2,3 delims=|" %%A in ("%AFFECTED%") do call :ROLLBACK_ITEM %%A "%%B" %%C
set "TRANSACTION_ACTIVE=0"
echo [復元] インストール前の状態へ戻しました。
exit /b 0

:ROLLBACK_ITEM
call :TARGET_FOR %~1 "%~2"
if exist "!TARGET!\NUL" (
  rd /s /q "!TARGET!" >nul 2>&1
) else if exist "!TARGET!" (
  del /q "!TARGET!" >nul 2>&1
)
if "%~3"=="0" exit /b 0
if /i "%~1"=="C" (
  set "BACKUP=%CLAUDE_BACKUP_DIR%\%~2"
) else (
  set "BACKUP=%CODEX_BACKUP_DIR%\%~2"
)
for %%P in ("!TARGET!") do if not exist "%%~dpP" mkdir "%%~dpP" >nul 2>&1
if /i "%~3"=="D" (
  xcopy "!BACKUP!" "!TARGET!\" /E /I /Y /Q /H >nul 2>&1
  exit /b 0
)
copy /Y "!BACKUP!" "!TARGET!" >nul 2>&1
exit /b 0

:CLEAN_WORK
if exist "%WORK_DIR%" rd /s /q "%WORK_DIR%" >nul 2>&1
exit /b 0

rem =============================================================
rem  エラー表示
rem =============================================================
:ERR_SRC
echo [エラー] インストールに必要なファイルまたはフォルダが見つかりません。
echo ZIPを「すべて展開」してから install-windows.bat を実行してください。
goto ERR_END

:ERR_TEMP
echo [エラー] 一時作業フォルダを作成できませんでした。
goto ERR_END

:ERR_FORMAT
echo [エラー] SKILL frontmatter、スキル名の重複、TOML必須形式、またはコピー元の形式検証に失敗しました。
echo 失敗段階: %AIDD_PHASE%
goto ERR_END

:ERR_SYMLINK
echo [確認] 上書き対象またはその祖先にシンボリックリンク、ジャンクション、reparse pointがあります。
echo リンク先を意図せず書き換えないよう、インストールを中断しました。
goto ERR_END

:ERR_BACKUP
echo [エラー] バックアップの作成または内容照合に失敗しました。
echo 既存ファイルは削除していません。
goto ERR_END

:ERR_STALE
echo [エラー] 旧配布ファイルの整理中に問題が発生しました。
call :ROLLBACK
goto ERR_END

:ERR_COPY
echo [エラー] ファイルのコピー中に問題が発生しました。
call :ROLLBACK
goto ERR_END

:ERR_VERIFY
echo [エラー] コピー元と配布先の内容照合、または導入記録の更新に失敗しました。
call :ROLLBACK
goto ERR_END

:ERR_END
call :CLEAN_WORK
echo 部分的な成功としては扱いません。必要に応じてインストール前の状態へ復元しました。
echo.
if not "%AIDD_NONINTERACTIVE%"=="1" pause
exit /b 1
