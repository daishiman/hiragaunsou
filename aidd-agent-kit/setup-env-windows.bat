@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
rem =====================================================
rem  開発環境セットアップ (Windows用)
rem  Node.js と pnpm をインストールし、Claude Code と
rem  Cloudflare の連携(MCP)も設定します
rem  ダブルクリックするだけでOKです
rem  v1.4.0
rem =====================================================

echo.
echo ===============================================
echo   開発環境セットアップ (Windows)
echo   Node.js と pnpm を準備します
echo ===============================================
echo.

set "PNPM_HOME=%LOCALAPPDATA%\pnpm"
set "PATH=%PNPM_HOME%;%PATH%"

rem --- ステップ 1/4: pnpm のインストール -------------------------
where pnpm >nul 2>nul
if %errorlevel%==0 (
    for /f "delims=" %%v in ('pnpm --version') do echo (1/4) pnpm はインストール済みです ^(%%v^)
) else (
    echo (1/4) pnpm をインストールしています(1〜2分)...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr https://get.pnpm.io/install.ps1 -useb | iex"
    set "PATH=%PNPM_HOME%;%PATH%"
    where pnpm >nul 2>nul
    if not !errorlevel!==0 (
        echo [エラー] pnpm のインストールに失敗しました。
        echo インターネット接続を確認して、もう一度実行してください。
        echo 社内ネットワークの通信制限が原因の場合があります。
        echo 解決しないときは、この画面のままIT担当者にお見せください。
        goto :fail
    )
    for /f "delims=" %%v in ('pnpm --version') do echo       pnpm %%v をインストールしました
)

rem --- ステップ 2/4: Node.js のインストール ----------------------
echo (2/4) Node.js を確認しています...
where node >nul 2>nul
if %errorlevel%==0 (
    for /f "delims=" %%v in ('node --version') do echo       Node.js はインストール済みです ^(%%v^)
) else (
    echo       Node.js をインストールしています(2〜3分)...
    call pnpm env use --global lts
    set "PATH=%PNPM_HOME%;%PATH%"
    where node >nul 2>nul
    if not !errorlevel!==0 (
        echo [エラー] Node.js のインストールに失敗しました。
        echo この画面のまま導入支援の担当者にお見せください。
        goto :fail
    )
    for /f "delims=" %%v in ('node --version') do echo       Node.js %%v をインストールしました
)

rem --- ステップ 3/4: Claude Code と Cloudflare の連携(MCP) --------
echo (3/4) Claude Code と Cloudflare の連携を設定しています...
where claude >nul 2>nul
if %errorlevel%==0 (
    call claude mcp add --transport sse cloudflare-bindings https://bindings.mcp.cloudflare.com/sse >nul 2>nul
    call claude mcp add --transport sse cloudflare-docs https://docs.mcp.cloudflare.com/sse >nul 2>nul
    echo       設定しました(初回利用時にブラウザで許可画面が開くことがあります)
) else (
    echo       Claude Code のコマンドが見つからないため、この設定はスキップしました。
    echo       (アプリ開発を始めるときに、AIが自動で案内します)
)

rem --- ステップ 4/4: 確認 ---------------------------------------
echo (4/4) 動作確認をしています...
echo.
echo ===============================================
echo   セットアップが完了しました！
echo ===============================================
echo.
for /f "delims=" %%v in ('node --version') do echo   Node.js: %%v
for /f "delims=" %%v in ('pnpm --version') do echo   pnpm:    %%v
echo.
echo 次にやること:
echo   開いているコマンドプロンプトやターミナルがあれば、
echo   一度閉じて開き直してください。(新しい設定を読み込むためです)
echo.
pause
exit /b 0

:fail
echo.
pause
exit /b 1
