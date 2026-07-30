@echo off
REM ============================================================================
REM  Current Weather App - Windows launcher
REM
REM  Double-click this file. It installs what's needed the first time, starts the
REM  app, and opens your browser. No commands to type.
REM
REM  Keep this window open while you use the app. Closing it stops the app.
REM ============================================================================

title Current Weather App
cd /d "%~dp0\..\server"

echo.
echo   Current Weather App
echo   ===================
echo.

REM --- Is Node installed? ---
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed, and the app needs it to run.
  echo.
  echo   1. Go to  https://nodejs.org
  echo   2. Download the "LTS" version and run the installer
  echo   3. Accept all the defaults
  echo   4. Close this window and double-click this file again
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node --version') do set NODEVER=%%v
echo   Node.js %NODEVER% found.

REM --- First run? Install dependencies. ---
if not exist "node_modules" (
  echo   First run - installing dependencies. This takes a minute...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  echo.
)

REM --- No settings file yet? Start from the example. ---
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo   Created server\.env - open it in Notepad to add your Gmail
  echo   App Password and Anthropic API key.
  echo.
)

echo   Starting the app...
echo   Your browser will open in a moment. Keep this window open.
echo.

REM Give the server a couple of seconds to bind the port, then open the browser.
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:8787"

node src/index.js

echo.
echo   The app has stopped.
pause
