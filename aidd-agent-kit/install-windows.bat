@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title AI開発エージェントキット インストーラー (Windows)
cd /d "%~dp0"

set "KIT_VERSION=1.3.0"
set "CLAUDE_DIR=%USERPROFILE%\.claude"
rem このキットが「自分で入れたもの」を記録するファイル。
rem 次回の更新時に、新しいキットに含まれなくなったものだけを安全に整理するために使う。
set "MANIFEST=%CLAUDE_DIR%\aidd-agent-kit.manifest"
set "VERSION_FILE=%CLAUDE_DIR%\aidd-agent-kit.version"

rem バックアップ用のタイムスタンプ（取得できない環境では固定名にする）
set "STAMP="
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss" 2^>nul') do set "STAMP=%%i"
if not defined STAMP set "STAMP=old"
set "BACKUP_DIR=%CLAUDE_DIR%\backup-%STAMP%"

echo.
echo ===============================================
echo   AI開発エージェントキット インストーラー
echo   バージョン %KIT_VERSION%
echo ===============================================
echo.

rem --- ステップ 1/6: キット本体の確認 ---------------------------
if not exist "skills" goto ERR_SRC
if not exist "agents" goto ERR_SRC
if not exist "commands" goto ERR_SRC

rem --- ステップ 2/6: インストール先の確認 -------------------------
echo インストール先: %CLAUDE_DIR%
echo.

if not exist "%CLAUDE_DIR%" goto ERR_NO_CLAUDE

rem 既に導入済みなら、更新であることを表示する(後からインストールした方が正)
if exist "%VERSION_FILE%" (
    set /p PREV_VERSION=<"%VERSION_FILE%"
    echo 現在インストールされているバージョン: !PREV_VERSION!
    echo このキット(%KIT_VERSION%)の内容で上書き更新します。
    echo (常に、後からインストールしたキットの内容が正になります)
    echo 使用中に蓄積されたナレッジ(各スキル内の knowledge\ など、
    echo キットが配布していない追加ファイル)は消さずにそのまま残します。
    echo.
)

rem 書き込み先が「別の場所への近道(リンク)」になっていないか調べる。
rem リンクのままコピーすると、意図しない別のフォルダに書き込まれてしまう。
set "LINK_NAME="
call :CHECK_LINK skills
if errorlevel 1 set "LINK_NAME=skills"
if not defined LINK_NAME (
  call :CHECK_LINK agents
  if errorlevel 1 set "LINK_NAME=agents"
)
if not defined LINK_NAME (
  call :CHECK_LINK commands
  if errorlevel 1 set "LINK_NAME=commands"
)
if defined LINK_NAME goto ERR_SYMLINK

if not exist "%CLAUDE_DIR%\skills" mkdir "%CLAUDE_DIR%\skills"
if not exist "%CLAUDE_DIR%\agents" mkdir "%CLAUDE_DIR%\agents"
if not exist "%CLAUDE_DIR%\commands" mkdir "%CLAUDE_DIR%\commands"

rem --- ステップ 3/6: 既存ファイルのバックアップ --------------------
set /a CONFLICT_COUNT=0
for /d %%D in (skills\*) do (
  if exist "%CLAUDE_DIR%\skills\%%~nxD" set /a CONFLICT_COUNT+=1
)
for %%F in (agents\*.md) do (
  if exist "%CLAUDE_DIR%\agents\%%~nxF" set /a CONFLICT_COUNT+=1
)
for %%F in (commands\*.md) do (
  if exist "%CLAUDE_DIR%\commands\%%~nxF" set /a CONFLICT_COUNT+=1
)

if !CONFLICT_COUNT! GTR 0 (
  echo 同じ名前のファイルが !CONFLICT_COUNT! 件見つかりました。
  echo このキットの内容で上書きします(上書き前にバックアップを作成します)。
  echo.
  for /d %%D in (skills\*) do (
    if exist "%CLAUDE_DIR%\skills\%%~nxD" (
      if not exist "%BACKUP_DIR%\skills" mkdir "%BACKUP_DIR%\skills"
      xcopy "%CLAUDE_DIR%\skills\%%~nxD" "%BACKUP_DIR%\skills\%%~nxD\" /E /I /Q >nul
    )
  )
  for %%F in (agents\*.md) do (
    if exist "%CLAUDE_DIR%\agents\%%~nxF" (
      if not exist "%BACKUP_DIR%\agents" mkdir "%BACKUP_DIR%\agents"
      copy /Y "%CLAUDE_DIR%\agents\%%~nxF" "%BACKUP_DIR%\agents\" >nul
    )
  )
  for %%F in (commands\*.md) do (
    if exist "%CLAUDE_DIR%\commands\%%~nxF" (
      if not exist "%BACKUP_DIR%\commands" mkdir "%BACKUP_DIR%\commands"
      copy /Y "%CLAUDE_DIR%\commands\%%~nxF" "%BACKUP_DIR%\commands\" >nul
    )
  )
  echo   バックアップ先: %BACKUP_DIR%
  echo.
)

rem --- ステップ 4/6: 廃止された古いスキル等の整理 -------------------
rem 「以前このキットが入れたもの(記録ファイルにある)」のうち、
rem 「新しいキットには含まれないもの」だけをバックアップへ移動する。
rem ユーザーが自分で追加したスキル等には一切触れない。
set /a STALE_COUNT=0
if exist "%MANIFEST%" (
  for /f "usebackq delims=" %%L in ("%MANIFEST%") do call :CLEAN_STALE "%%L"
  if !STALE_COUNT! GTR 0 (
    echo 新しいキットに含まれなくなった古いスキル等を !STALE_COUNT! 件、
    echo バックアップへ移動して整理しました。
    echo (中にナレッジが入っていた場合もバックアップに残っています)
    echo.
  )
)

rem --- ステップ 5/6: コピー ------------------------------------
echo (1/3) スキル(開発ノウハウ集)をコピーしています...
xcopy "skills" "%CLAUDE_DIR%\skills\" /E /I /Y /Q >nul
if errorlevel 1 goto ERR_COPY

echo (2/3) エージェント(自動開発の司令塔)をコピーしています...
xcopy "agents" "%CLAUDE_DIR%\agents\" /E /I /Y /Q >nul
if errorlevel 1 goto ERR_COPY

echo (3/3) コマンド(/build-app, /improve-app, /undo-app)をコピーしています...
xcopy "commands" "%CLAUDE_DIR%\commands\" /E /I /Y /Q >nul
if errorlevel 1 goto ERR_COPY

echo.

rem --- ステップ 6/6: 全件検証と導入記録の更新 ----------------------
set /a EXPECTED=0
set /a INSTALLED=0
set "MISSING="

for /d %%D in (skills\*) do (
  set /a EXPECTED+=1
  if exist "%CLAUDE_DIR%\skills\%%~nxD\SKILL.md" (
    set /a INSTALLED+=1
  ) else (
    set "MISSING=!MISSING! スキル:%%~nxD"
  )
)
for %%F in (agents\*.md) do (
  if not exist "%CLAUDE_DIR%\agents\%%~nxF" set "MISSING=!MISSING! agents\%%~nxF"
)
for %%F in (commands\*.md) do (
  if not exist "%CLAUDE_DIR%\commands\%%~nxF" set "MISSING=!MISSING! commands\%%~nxF"
)

if defined MISSING goto ERR_VERIFY

rem 今回入れたものの一覧を記録する(次回更新時の整理に使う)
(
  for /d %%D in (skills\*) do @echo skills\%%~nxD
  for %%F in (agents\*.md) do @echo agents\%%~nxF
  for %%F in (commands\*.md) do @echo commands\%%~nxF
) > "%MANIFEST%"
echo %KIT_VERSION%> "%VERSION_FILE%"

echo ===============================================
echo   インストールが完了しました！
echo ===============================================
echo.
echo   スキル: !INSTALLED!個 / !EXPECTED!個
echo   エージェント: app-orchestrator
echo   コマンド: /build-app, /improve-app, /undo-app
if !CONFLICT_COUNT! GTR 0 (
  echo.
  echo   以前のファイルは次の場所に保存してあります:
  echo   %BACKUP_DIR%
)
echo.
echo 次にやること:
echo   1. Claude Code を終了して起動し直す
echo   2. 「/build-app 作りたいものの説明」と入力する
echo.
pause
exit /b 0

rem =============================================================
rem  サブルーチン: リンク(リパースポイント)かどうか調べる
rem  リンクなら exit /b 1 を返す
rem =============================================================
:CHECK_LINK
if not exist "%CLAUDE_DIR%\%~1" exit /b 0
rem リパースポイント(シンボリックリンク/ジャンクション)かどうかを判定する
fsutil reparsepoint query "%CLAUDE_DIR%\%~1" >nul 2>&1
if not errorlevel 1 exit /b 1
rem fsutil が使えない環境向けのフォールバック
dir /a:l "%CLAUDE_DIR%" 2>nul | findstr /i /c:" %~1 " >nul
if not errorlevel 1 exit /b 1
exit /b 0

rem =============================================================
rem  サブルーチン: 記録ファイルの1行分について、
rem  新しいキットに無ければバックアップへ移動する
rem =============================================================
:CLEAN_STALE
set "ITEM=%~1"
if "%ITEM%"=="" exit /b 0
rem 安全装置: 上位フォルダ参照は無視する
echo %ITEM% | findstr /c:".." >nul && exit /b 0
rem 安全装置: 想定パス(skills\ agents\ commands\)以外は無視する
echo %ITEM% | findstr /b /c:"skills\" /c:"agents\" /c:"commands\" >nul
if errorlevel 1 exit /b 0
rem インストール先に無ければ何もしない
if not exist "%CLAUDE_DIR%\%ITEM%" exit /b 0
rem 新しいキットにまだ含まれているなら何もしない
if exist "%ITEM%" exit /b 0
rem ここまで来たら「以前のキットにはあったが、新しいキットには無い」もの
if exist "%CLAUDE_DIR%\%ITEM%\*" (
  rem フォルダ(スキル)の場合
  if not exist "%BACKUP_DIR%\%ITEM%" mkdir "%BACKUP_DIR%\%ITEM%"
  xcopy "%CLAUDE_DIR%\%ITEM%" "%BACKUP_DIR%\%ITEM%\" /E /I /Q >nul
  rd /s /q "%CLAUDE_DIR%\%ITEM%"
) else (
  rem ファイル(エージェント・コマンド)の場合
  for %%P in ("%BACKUP_DIR%\%ITEM%") do if not exist "%%~dpP" mkdir "%%~dpP"
  copy /Y "%CLAUDE_DIR%\%ITEM%" "%BACKUP_DIR%\%ITEM%" >nul
  del /q "%CLAUDE_DIR%\%ITEM%"
)
set /a STALE_COUNT+=1
exit /b 0

rem =============================================================
rem  エラー表示
rem =============================================================
:ERR_SRC
echo [エラー] インストールに必要なフォルダが見つかりません。
echo.
echo ZIPを「すべて展開」してできたフォルダの中にある
echo install-windows.bat を実行してください。
echo ZIPの中身を直接ダブルクリックすると失敗します。
echo.
pause
exit /b 1

:ERR_NO_CLAUDE
echo [確認] %CLAUDE_DIR% が見つかりません。
echo.
echo Claude Code をまだ一度も起動していない可能性があります。
echo 先に Claude Code を起動してサインインを済ませてから、
echo もう一度このインストーラーを実行してください。
echo.
pause
exit /b 1

:ERR_SYMLINK
echo [確認] %CLAUDE_DIR%\%LINK_NAME% は、別の場所への「近道(リンク)」になっています。
echo.
echo このままコピーすると、リンク先のフォルダが書き換えられてしまいます。
echo 関係のない場所を壊さないよう、インストールを中断しました。
echo.
echo 対処方法(詳しい方向け):
echo   1. コマンドプロンプトで次を実行し、リンクを一時的に退避します
echo        move "%CLAUDE_DIR%\%LINK_NAME%" "%CLAUDE_DIR%\%LINK_NAME%.bak"
echo   2. もう一度このインストーラーを実行します
echo.
echo ご不明な場合は、この画面のまま導入支援の担当者にお見せください。
echo.
pause
exit /b 1

:ERR_COPY
echo [エラー] ファイルのコピー中に問題が発生しました。
echo.
echo 次の点をご確認ください:
echo   - 空き容量が十分にあるか(50MB程度)
echo   - ウイルス対策ソフトがコピーを止めていないか
echo.
echo 解決しない場合は、マニュアルの「うまくいかないとき」の
echo Q1(手動コピー)をお試しください。
echo.
pause
exit /b 1

:ERR_VERIFY
echo [エラー] 次のものをインストールできませんでした。
echo.
for %%M in (!MISSING!) do echo   - %%M
echo.
echo スキル: !INSTALLED!個 / !EXPECTED!個 のみ成功
echo.
echo マニュアルの「うまくいかないとき」の Q1(手動コピー)をお試しください。
echo.
pause
exit /b 1
