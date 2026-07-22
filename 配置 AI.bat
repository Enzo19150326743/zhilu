@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\scripts\configure-ai.ps1"
if not "%ERRORLEVEL%"=="0" echo AI configuration failed. Exit code: %ERRORLEVEL%.
pause
