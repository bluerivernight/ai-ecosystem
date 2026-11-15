@echo off
REM Removes the watchdog scheduled task.
schtasks /Delete /TN "AIEcosystemWatchdog" /F
pause
