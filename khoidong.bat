@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

set "APP_URL=http://localhost:9090"

echo.
echo =========================================
echo  GenPoster - Khoi dong he thong
echo =========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Chua co Node.js. Hay chay setup.bat truoc.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Chua co npm. Hay chay setup.bat truoc.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Chua co thu muc node_modules. Hay chay setup.bat truoc.
  pause
  exit /b 1
)

echo Web se mo tai %APP_URL%
start "Mo GenPoster" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3; Start-Process '%APP_URL%'"
echo.
echo Dang chay server. Dung tat cua so nay khi con dung app.
echo Nhan Ctrl+C de dung server.
echo.

npm run dev -- --host 0.0.0.0 --port 9090

echo.
echo Server da dung.
pause
