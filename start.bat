@echo off
REM Start the AI Ecosystem world. Builds it first if needed.
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

start "" http://localhost:8080
node dist-server\server\main.js
pause
