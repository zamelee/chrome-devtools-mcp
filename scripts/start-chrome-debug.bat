@echo off
REM ==============================================================
REM   Start Chrome with --remote-debugging-port=9222 for the
REM   chrome-devtools-mcp Codex MCP server. Run BEFORE starting
REM   Codex or in another window so MCP can connect.
REM
REM   - Profile defaults to %TEMP%\chrome-debug, same dir as the legacy
REM     "Google ChromeDEBUG.lnk" shortcut on the desktop, so your
REM     extensions and login cookies survive. Override with the env var
REM     CHROME_MCP_PROFILE=<path> for a clean profile (CI / smoke tests).
REM   - Re-runnable: if Chrome is already up on 9222 the script
REM     reports it and exits.
REM   - Self-closing: leaves a 5-10s status footer before closing.
REM ==============================================================

setlocal EnableExtensions

REM ---- Configurable: default Chrome path, fallback, debug port ----
set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
REM Default profile mirrors the legacy "Google ChromeDEBUG.lnk" shortcut on
REM the desktop: %TEMP%\chrome-debug. It contains the extensions and
REM cookies accumulated from prior sessions (mcp-chrome, etc), which is
REM what you want for a real workflow.
REM Override to a clean profile for CI / smoke tests by setting the env var
REM CHROME_MCP_PROFILE before launching (e.g. set CHROME_MCP_PROFILE=%TEMP%\chrome-mcp-debug).
if defined CHROME_MCP_PROFILE (set "USER_DATA_DIR=%CHROME_MCP_PROFILE%") else set "USER_DATA_DIR=%TEMP%\chrome-debug"
set "DEBUG_PORT=9222"

if not exist "%USER_DATA_DIR%" mkdir "%USER_DATA_DIR%"

REM ---- Locate chrome.exe; default first, then two fallbacks ----
if not exist "%CHROME_EXE%" set "CHROME_EXE=C:\Program Files^ ^(x86^)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=D:\Program Files\Chrome\chrome.exe"

if not exist "%CHROME_EXE%" goto :nochrome

echo.
echo === Chrome MCP Debug launcher ===============================
echo   Chrome:       %CHROME_EXE%
echo   Profile:      %USER_DATA_DIR%
echo   Debug port:   %DEBUG_PORT%
echo ==============================================================
echo.

REM ---- Check if a debug instance is already alive on 9222 ----
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:%DEBUG_PORT%/json/version' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL%==0 (
    echo [OK] Chrome debug instance already running on port %DEBUG_PORT%.
    echo       Connect Codex MCP chrome-devtools-mcp -- no need to relaunch.
    echo.
    echo Closing in 5s...
    timeout /t 5 /nobreak >nul
    goto :eof
)

REM ---- Launch Chrome via PowerShell to dodge cmd start/spaces tokenizing bug ----
echo [LAUNCH] Starting Chrome with --remote-debugging-port=%DEBUG_PORT% ...
powershell -NoProfile -Command "Start-Process -FilePath '%CHROME_EXE%' -ArgumentList '--remote-debugging-port=%DEBUG_PORT%','--user-data-dir=%USER_DATA_DIR%','--no-first-run','--no-default-browser-check','--remote-allow-origins=*','about:blank'"

REM ---- Poll up to 8s for Chrome to bind 9222 ----
echo [WAIT ] Waiting up to 8s for Chrome to listen on %DEBUG_PORT% ...
set /a tries=0
:waitloop
set /a tries+=1
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:%DEBUG_PORT%/json/version' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL%==0 goto :ready
if %tries% GEQ 8 (
    echo.
    echo [FAIL] Chrome did not bind port %DEBUG_PORT% within 8s.
    echo         Check that no firewall rule blocks the port and that
    echo         --remote-debugging-port=%DEBUG_PORT% was honored.
    echo.
    timeout /t 10 /nobreak >nul
    endlocal
    exit /b 2
)
ping -n 2 127.0.0.1 >nul
goto :waitloop

:ready
echo [OK ] Chrome is listening on http://127.0.0.1:%DEBUG_PORT%/json/version
echo       Codex MCP chrome-devtools-mcp can now connect.
echo.
echo Closing in 5s...
timeout /t 5 /nobreak >nul
endlocal
exit /b 0

:nochrome
echo.
echo [ERROR] chrome.exe not found at: %CHROME_EXE%
echo         Edit this .bat and set CHROME_EXE to your install path.
echo.
timeout /t 10 /nobreak >nul
endlocal
exit /b 1
