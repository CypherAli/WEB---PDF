@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm.cmd install
if errorlevel 1 goto error
echo Install complete. Open Run.cmd to start.
pause
exit /b 0
:error
echo Install failed. Check your Internet connection and Node.js.
pause
exit /b 1
