@echo off
REM Headless mode: agents run 24/7 with no browser needed. Zero GPU work.
cd /d "%~dp0"

if not exist dist-server\server\main.js (
  echo Building first time... takes about a minute.
  call npm run build
  if errorlevel 1 (
    echo.
    echo Build failed. Make sure you ran: npm install
    pause
    exit /b 1
  )
)

node dist-server\server\main.js --headless
