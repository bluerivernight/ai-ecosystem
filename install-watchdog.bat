@echo off
REM One-time: installs a Windows Scheduled Task that runs watchdog.bat every minute.
REM Admin rights are required (Windows will ask).
cd /d "%~dp0"

schtasks /Create /TN "AIEcosystemWatchdog" /TR "\"%~dp0watchdog.bat\"" /SC MINUTE /MO 1 /F /RL HIGHEST
if %errorlevel%==0 (
  echo Watchdog installed. It restarts the world automatically if it crashes.
) else (
  echo Could not install. Try right-clicking this file and choosing "Run as administrator".
)
pause
