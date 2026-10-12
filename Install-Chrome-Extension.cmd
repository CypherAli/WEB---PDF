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
echo Select this folder when you click Load unpacked in Chrome:
echo %~dp0extension
echo.
echo Open chrome://extensions, enable Developer mode, click Load unpacked.
echo After install: pin Ali Web to PDF from the Chrome puzzle menu.
pause
