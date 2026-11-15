@echo off
cd /d "%~dp0"
echo [update] pulling the latest version from GitHub...
git fetch origin
git reset --hard origin/main
echo [update] installing dependencies...
call npm install
if errorlevel 1 goto fail
echo [update] rebuilding the app...
call npm run build
if errorlevel 1 goto fail
echo.
echo [update] Done! Your data, config and workspace were NOT touched.
echo [update] Run start.bat to launch the new version.
pause
exit /b 0
:fail
echo.
echo [update] FAILED^! Read the error above and send data\report.zip (run report-log.bat) to the developer.
pause
exit /b 1
