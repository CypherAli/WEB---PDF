@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "ALI_CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%ALI_CHROME%" set "ALI_CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%ALI_CHROME%" (
  start "" "%ALI_CHROME%" "%~dp0extension\help.html" "chrome://extensions/"
) else (
  start "" "%~dp0extension\help.html"
)
echo.
echo Thu muc can chon khi bam Load unpacked trong Chrome:
echo %~dp0extension
echo.
echo Mo chrome://extensions, bat Developer mode, chon Load unpacked.
echo Sau khi cai: ghim Ali Web to PDF trong menu manh ghep Chrome.
pause
