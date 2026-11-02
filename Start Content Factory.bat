@echo off
REM Windows: double-click to start.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Opening the download page - install it, then double-click this file again.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)
npm run go
pause
