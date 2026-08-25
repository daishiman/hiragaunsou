@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
rem =====================================================
rem  開発環境セットアップ (Windows用)
rem  Node.js と pnpm をインストールし、Claude Code / Codex と
rem  Cloudflare の連携(MCP)も設定します
rem  ダブルクリックするだけでOKです
rem  v1.10.4
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
    call :GET_TOOL_VERSION pnpm PNPM_VERSION
    if not !errorlevel!==0 (
        echo [エラー] pnpm コマンドは見つかりましたが、正常に実行できません。
        echo pnpm のインストールを修復してから、もう一度実行してください。
        goto :fail
    )
    echo (1/4) pnpm はインストール済みです ^(!PNPM_VERSION!^)
) else (
    echo (1/4) pnpm をインストールしています(1〜2分)...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr https://get.pnpm.io/install.ps1 -useb | iex"
    set "PATH=%PNPM_HOME%;%PATH%"
    call :GET_TOOL_VERSION pnpm PNPM_VERSION
    if not !errorlevel!==0 (
        echo [エラー] pnpm のインストールに失敗しました。
        echo インターネット接続を確認して、もう一度実行してください。
        echo 社内ネットワークの通信制限が原因の場合があります。
        echo 解決しないときは、この画面のままIT担当者にお見せください。
        goto :fail
    )
    echo       pnpm !PNPM_VERSION! をインストールしました
)

rem --- ステップ 2/4: Node.js のインストール ----------------------
echo (2/4) Node.js を確認しています...
where node >nul 2>nul
if %errorlevel%==0 (
    call :GET_TOOL_VERSION node NODE_VERSION
    if not !errorlevel!==0 (
        echo [エラー] Node.js コマンドは見つかりましたが、正常に実行できません。
        echo Node.js のインストールを修復してから、もう一度実行してください。
        goto :fail
    )
    echo       Node.js はインストール済みです ^(!NODE_VERSION!^)
) else (
    echo       Node.js をインストールしています(2〜3分)...
    call pnpm env use --global lts
    set "PATH=%PNPM_HOME%;%PATH%"
    call :GET_TOOL_VERSION node NODE_VERSION
    if not !errorlevel!==0 (
        echo [エラー] Node.js のインストールに失敗しました。
        echo この画面のまま導入支援の担当者にお見せください。
        goto :fail
    )
    echo       Node.js !NODE_VERSION! をインストールしました
)

rem --- ステップ 3/4: AI開発ツールと Cloudflare の連携(MCP) ---------
echo (3/4) Claude Code / Codex と Cloudflare の連携を設定しています...
set /a MCP_FAILURES=0
set /a MCP_PENDING=0
set /a CLAUDE_MCP_PENDING=0
set /a CODEX_MCP_PENDING=0
set "CODEX_PENDING_SERVERS="

where claude >nul 2>nul
if %errorlevel%==0 (
    call :CONFIGURE_CLAUDE_MCP "cloudflare-bindings" "https://bindings.mcp.cloudflare.com/mcp"
    call :CONFIGURE_CLAUDE_MCP "cloudflare-docs" "https://docs.mcp.cloudflare.com/mcp"
) else (
    echo       Claude Code: スキップ^(コマンドが見つかりません^)
)
where codex >nul 2>nul
if %errorlevel%==0 (
    call :CONFIGURE_CODEX_MCP "cloudflare-bindings" "https://bindings.mcp.cloudflare.com/mcp"
    call :CONFIGURE_CODEX_MCP "cloudflare-docs" "https://docs.mcp.cloudflare.com/mcp"
) else (
    echo       OpenAI Codex: スキップ^(コマンドが見つかりません^)
)
echo       (認証待ちの項目は、下に表示する手順で認証してください)

rem --- ステップ 4/4: 確認 ---------------------------------------
echo (4/4) 動作確認をしています...
echo.
echo   Node.js: !NODE_VERSION!
echo   pnpm:    !PNPM_VERSION!
echo.
if !MCP_FAILURES! GTR 0 (
    echo [エラー] Cloudflare MCP の設定または確認に !MCP_FAILURES! 件失敗しました。
    echo 上の失敗内容を確認してから、もう一度実行してください。
    goto :fail
)
if !MCP_PENDING! GTR 0 (
    echo ===============================================
    echo   基本セットアップ完了 / Cloudflare MCP は認証待ち
    echo ===============================================
    echo.
    echo 次に認証してください:
    if !CLAUDE_MCP_PENDING!==1 echo   Claude Code: Claude Code を開き、/mcp から認証待ちの項目を認証
    if !CODEX_MCP_PENDING!==1 (
        echo   OpenAI Codex: ターミナルで次を順に実行
        for %%S in (!CODEX_PENDING_SERVERS!) do echo     codex mcp login %%S
    )
    echo   認証後、このセットアップを再実行すると接続readyを確認できます。
    echo.
    pause
    exit /b 0
)
echo ===============================================
echo   セットアップが完全に完了しました！
echo ===============================================
echo.
echo 次にやること:
echo   開いているコマンドプロンプトやターミナルがあれば、
echo   一度閉じて開き直してください。(新しい設定を読み込むためです)
echo.
pause
exit /b 0

:GET_TOOL_VERSION
set "%~2="
set "VERSION_FILE=%TEMP%\aidd-agent-kit-version-!RANDOM!-!RANDOM!.txt"
call %~1 --version >"!VERSION_FILE!" 2>nul
set "VERSION_STATUS=!errorlevel!"
if "!VERSION_STATUS!"=="0" set /p "%~2="<"!VERSION_FILE!"
del /q "!VERSION_FILE!" >nul 2>nul
if not "!VERSION_STATUS!"=="0" exit /b 1
if not defined %~2 exit /b 1
exit /b 0

:REPORT_CLAUDE_MCP_STATUS
set "MCP_NAME=%~1"
set "MCP_URL=%~2"
set "MCP_CHECK_FILE=%~3"
set "MCP_ACTION=%~4"
set "MCP_MATCH=1"
findstr /l /c:"Scope: User config" "%MCP_CHECK_FILE%" >nul || set "MCP_MATCH=0"
findstr /l /c:"Type: http" "%MCP_CHECK_FILE%" >nul || set "MCP_MATCH=0"
findstr /l /c:"URL: %MCP_URL%" "%MCP_CHECK_FILE%" >nul || set "MCP_MATCH=0"
if not "!MCP_MATCH!"=="1" exit /b 1

findstr /i /l /c:"Connected" "%MCP_CHECK_FILE%" >nul
if !errorlevel!==0 (
    echo       Claude Code / %MCP_NAME%: %MCP_ACTION%^(接続ready^)
    exit /b 0
)
findstr /i /l /c:"Needs authentication" /c:"Authentication required" /c:"Needs auth" "%MCP_CHECK_FILE%" >nul
if !errorlevel!==0 (
    echo       Claude Code / %MCP_NAME%: 設定済み・認証待ち
    set /a MCP_PENDING+=1
    set /a CLAUDE_MCP_PENDING=1
    exit /b 0
)
echo       Claude Code / %MCP_NAME%: 失敗^(接続状態がreadyではありません^)
type "%MCP_CHECK_FILE%"
set /a MCP_FAILURES+=1
exit /b 0

:CONFIGURE_CLAUDE_MCP
set "MCP_NAME=%~1"
set "MCP_URL=%~2"
set "MCP_CHECK_FILE=%TEMP%\aidd-agent-kit-mcp-!RANDOM!-!RANDOM!.txt"

call claude mcp get "%MCP_NAME%" >"%MCP_CHECK_FILE%" 2>&1
set "MCP_GET_STATUS=!errorlevel!"
if "!MCP_GET_STATUS!"=="0" (
    set "MCP_MATCH=1"
    findstr /l /c:"Scope: User config" "%MCP_CHECK_FILE%" >nul || set "MCP_MATCH=0"
    findstr /l /c:"Type: http" "%MCP_CHECK_FILE%" >nul || set "MCP_MATCH=0"
    findstr /l /c:"URL: %MCP_URL%" "%MCP_CHECK_FILE%" >nul || set "MCP_MATCH=0"
    if "!MCP_MATCH!"=="1" (
        call :REPORT_CLAUDE_MCP_STATUS "%MCP_NAME%" "%MCP_URL%" "%MCP_CHECK_FILE%" "スキップ"
        del /q "%MCP_CHECK_FILE%" >nul 2>nul
        exit /b 0
    )
)
if not "!MCP_GET_STATUS!"=="0" (
    findstr /l /c:"No MCP server named" /c:"No MCP server found with name" "%MCP_CHECK_FILE%" >nul
    if not !errorlevel!==0 (
        echo       Claude Code / %MCP_NAME%: 失敗^(現在の設定を確認できませんでした^)
        type "%MCP_CHECK_FILE%"
        set /a MCP_FAILURES+=1
        del /q "%MCP_CHECK_FILE%" >nul 2>nul
        exit /b 0
    )
)
if "!MCP_GET_STATUS!"=="0" (

    echo       Claude Code / %MCP_NAME%: 古い設定を更新します
    call claude mcp remove "%MCP_NAME%"
    if not !errorlevel!==0 (
        echo       Claude Code / %MCP_NAME%: 失敗^(古い設定を削除できませんでした^)
        set /a MCP_FAILURES+=1
        del /q "%MCP_CHECK_FILE%" >nul 2>nul
        exit /b 0
    )
)

call claude mcp add --transport http --scope user "%MCP_NAME%" "%MCP_URL%"
set "MCP_ADD_STATUS=!errorlevel!"
call claude mcp get "%MCP_NAME%" >"%MCP_CHECK_FILE%" 2>&1
set "MCP_GET_STATUS=!errorlevel!"
if "!MCP_GET_STATUS!"=="0" (
    call :REPORT_CLAUDE_MCP_STATUS "%MCP_NAME%" "%MCP_URL%" "%MCP_CHECK_FILE%" "成功"
    if not !MCP_ADD_STATUS!==0 (
        echo       Claude Code / %MCP_NAME%: 失敗^(CLI終了コード !MCP_ADD_STATUS!^)
        set /a MCP_FAILURES+=1
    )
) else (
    echo       Claude Code / %MCP_NAME%: 失敗^(設定後の確認NG、CLI終了コード !MCP_ADD_STATUS!^)
    type "%MCP_CHECK_FILE%"
    set /a MCP_FAILURES+=1
)
del /q "%MCP_CHECK_FILE%" >nul 2>nul
exit /b 0

:GET_CODEX_AUTH_STATUS
set "MCP_NAME=%~1"
set "CODEX_AUTH_STATUS="
set "MCP_LIST_FILE=%TEMP%\aidd-agent-kit-mcp-list-!RANDOM!-!RANDOM!.json"
set "MCP_AUTH_FILE=%TEMP%\aidd-agent-kit-mcp-auth-!RANDOM!-!RANDOM!.txt"
call codex mcp list --json >"!MCP_LIST_FILE!" 2>&1
set "MCP_LIST_STATUS=!errorlevel!"
if not "!MCP_LIST_STATUS!"=="0" (
    type "!MCP_LIST_FILE!"
    del /q "!MCP_LIST_FILE!" "!MCP_AUTH_FILE!" >nul 2>nul
    exit /b 1
)
call node -e "let i='';process.stdin.on('data',c=^>i+=c);process.stdin.on('end',()=^>{const s=JSON.parse(i).find(x=^>x.name===process.argv[1]);if(!s^|^|typeof s.auth_status!=='string')process.exit(2);process.stdout.write(s.auth_status)})" "%MCP_NAME%" <"!MCP_LIST_FILE!" >"!MCP_AUTH_FILE!" 2>nul
set "MCP_PARSE_STATUS=!errorlevel!"
if "!MCP_PARSE_STATUS!"=="0" set /p "CODEX_AUTH_STATUS="<"!MCP_AUTH_FILE!"
del /q "!MCP_LIST_FILE!" "!MCP_AUTH_FILE!" >nul 2>nul
if not "!MCP_PARSE_STATUS!"=="0" exit /b 1
if not defined CODEX_AUTH_STATUS exit /b 1
exit /b 0

:REPORT_CODEX_MCP_STATUS
set "MCP_NAME=%~1"
call :GET_CODEX_AUTH_STATUS "%MCP_NAME%"
if not !errorlevel!==0 (
    echo       OpenAI Codex / %MCP_NAME%: 失敗^(認証状態を確認できませんでした^)
    set /a MCP_FAILURES+=1
    exit /b 0
)
if /i "!CODEX_AUTH_STATUS!"=="o_auth" (
    echo       OpenAI Codex / %MCP_NAME%: 設定済み・認証済み^(接続ready^)
    exit /b 0
)
if /i "!CODEX_AUTH_STATUS!"=="bearer_token" (
    echo       OpenAI Codex / %MCP_NAME%: 設定済み・認証済み^(接続ready^)
    exit /b 0
)
if /i "!CODEX_AUTH_STATUS!"=="not_logged_in" (
    echo       OpenAI Codex / %MCP_NAME%: 設定済み・認証待ち
    set /a MCP_PENDING+=1
    set /a CODEX_MCP_PENDING=1
    set "CODEX_PENDING_SERVERS=!CODEX_PENDING_SERVERS! %MCP_NAME%"
    exit /b 0
)
if /i "!CODEX_AUTH_STATUS!"=="unsupported" (
    echo       OpenAI Codex / %MCP_NAME%: 設定済み・認証不要^(接続ready^)
    exit /b 0
)
echo       OpenAI Codex / %MCP_NAME%: 失敗^(未確認の認証状態: !CODEX_AUTH_STATUS!^)
set /a MCP_FAILURES+=1
exit /b 0

:RUN_CODEX_MCP_ADD
set "MCP_NAME=%~1"
set "MCP_URL=%~2"
rem Codex CLIがOAuth対応を検出した場合は、ブラウザ認証の案内を表示し完了を待つ。
call codex mcp add "%MCP_NAME%" --url "%MCP_URL%"
set "CODEX_ADD_STATUS=!errorlevel!"
exit /b 0

:CONFIGURE_CODEX_MCP
set "MCP_NAME=%~1"
set "MCP_URL=%~2"
set "MCP_CHECK_FILE=%TEMP%\aidd-agent-kit-mcp-!RANDOM!-!RANDOM!.txt"

call codex mcp get "%MCP_NAME%" --json >"%MCP_CHECK_FILE%" 2>&1
set "MCP_GET_STATUS=!errorlevel!"
if "!MCP_GET_STATUS!"=="0" (
    set "MCP_MATCH=1"
    findstr /l /c:"streamable_http" "%MCP_CHECK_FILE%" >nul || set "MCP_MATCH=0"
    findstr /l /c:"%MCP_URL%" "%MCP_CHECK_FILE%" >nul || set "MCP_MATCH=0"
    if "!MCP_MATCH!"=="1" (
        call :REPORT_CODEX_MCP_STATUS "%MCP_NAME%"
        del /q "%MCP_CHECK_FILE%" >nul 2>nul
        exit /b 0
    )
)
if not "!MCP_GET_STATUS!"=="0" (
    findstr /l /c:"No MCP server named" /c:"No MCP server found with name" "%MCP_CHECK_FILE%" >nul
    if not !errorlevel!==0 (
        echo       OpenAI Codex / %MCP_NAME%: 失敗^(現在の設定を確認できませんでした^)
        type "%MCP_CHECK_FILE%"
        set /a MCP_FAILURES+=1
        del /q "%MCP_CHECK_FILE%" >nul 2>nul
        exit /b 0
    )
)
if "!MCP_GET_STATUS!"=="0" (

    echo       OpenAI Codex / %MCP_NAME%: 古い設定を更新します
    call codex mcp remove "%MCP_NAME%"
    if not !errorlevel!==0 (
        echo       OpenAI Codex / %MCP_NAME%: 失敗^(古い設定を削除できませんでした^)
        set /a MCP_FAILURES+=1
        del /q "%MCP_CHECK_FILE%" >nul 2>nul
        exit /b 0
    )
)

call :RUN_CODEX_MCP_ADD "%MCP_NAME%" "%MCP_URL%"
call codex mcp get "%MCP_NAME%" --json >"%MCP_CHECK_FILE%" 2>&1
set "MCP_GET_STATUS=!errorlevel!"
set "MCP_MATCH=1"
if not "!MCP_GET_STATUS!"=="0" set "MCP_MATCH=0"
findstr /l /c:"streamable_http" "%MCP_CHECK_FILE%" >nul || set "MCP_MATCH=0"
findstr /l /c:"%MCP_URL%" "%MCP_CHECK_FILE%" >nul || set "MCP_MATCH=0"
if "!MCP_MATCH!"=="1" (
    call :REPORT_CODEX_MCP_STATUS "%MCP_NAME%"
) else (
    echo       OpenAI Codex / %MCP_NAME%: 失敗^(設定後の確認NG、CLI終了コード !CODEX_ADD_STATUS!^)
    type "%MCP_CHECK_FILE%"
    set /a MCP_FAILURES+=1
)
del /q "%MCP_CHECK_FILE%" >nul 2>nul
exit /b 0

:fail
echo.
pause
exit /b 1
