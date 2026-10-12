@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm.cmd install
if errorlevel 1 goto error
echo Cai dat xong. Mo Chay-cong-cu.cmd de bat dau.
pause
exit /b 0
:error
echo Khong cai dat duoc. Kiem tra ket noi Internet va Node.js.
pause
exit /b 1
