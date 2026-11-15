@echo off
cd /d "%~dp0"
echo [report] collecting logs and crash reports...
node scripts\make-report.mjs
if not exist "data\report" (
  echo [report] nothing collected — is the project folder intact?
  pause
  exit /b 1
)
powershell -NoProfile -Command "Compress-Archive -Path 'data\report\*' -DestinationPath 'data\report.zip' -Force"
echo.
echo [report] Done: data\report.zip
echo [report] Send this one file (email, Discord, anything) to the developer.
start "" explorer /select,"data\report.zip"
pause
