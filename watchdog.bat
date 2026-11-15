@echo off
REM Watchdog: restarts the headless server if it died. Installed as a
REM Windows Scheduled Task that runs every minute. Run install-watchdog.bat once.
cd /d "%~dp0"

REM is anything already listening on the port? If yes, we're fine.
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', 8080); $c.Close(); exit 0 } catch { exit 1 }"
if %errorlevel%==0 exit /b 0

echo [%date% %time%] server down — restarting >> "%~dp0data\watchdog.log"
start "" /min cmd /c "%~dp0start-headless.bat"
