@echo off
REM OpenClaw Installation Fix Script for Windows
REM This script fixes common OpenClaw startup/crash issues.

echo ============================================
echo   OpenClaw Installation Fix Script
echo ============================================
echo.

REM Step 1: Verify Node.js is available
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Please install Node.js 18+ first.
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js found

REM Step 2: Reinstall openclaw globally (clean install)
echo.
echo Reinstalling OpenClaw...
call npm install -g openclaw@latest
if %errorlevel% neq 0 (
    echo ERROR: npm install failed. Try running this script as Administrator.
    pause
    exit /b 1
)
echo [OK] OpenClaw installed

REM Step 3: Run setup to create state directory and config
echo.
echo Running OpenClaw setup...
call openclaw setup
echo [OK] Setup complete

REM Step 4: Set gateway mode to local
echo.
echo Configuring gateway mode...
call openclaw config set gateway.mode local
echo [OK] Gateway mode set to local

REM Step 5: Run doctor --fix to auto-repair remaining issues
echo.
echo Running doctor --fix...
call openclaw doctor --fix
echo.

REM Step 6: Verify
echo.
echo ============================================
echo   Verification
echo ============================================
call openclaw --version
call openclaw health 2>nul
echo.
echo Fix script complete. You can now run: openclaw gateway
echo Or start the TUI with: openclaw tui
pause
