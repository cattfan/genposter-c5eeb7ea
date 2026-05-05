@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

echo.
echo =========================================
echo  GenPoster - Setup moi truong
echo =========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Chua thay Node.js. Dang thu cai Node.js LTS bang winget...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo Khong thay winget tren may.
    echo Hay cai Node.js LTS tai: https://nodejs.org/
    start "" "https://nodejs.org/"
    pause
    exit /b 1
  )
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
)

set "PATH=%ProgramFiles%\nodejs;%AppData%\npm;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Van chua nhan Node.js. Hay dong cua so nay, mo lai roi chay setup.bat lan nua.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Khong thay npm. Hay cai lai Node.js LTS roi chay setup.bat lan nua.
  pause
  exit /b 1
)

echo Node:
node -v
echo npm:
npm -v
echo.

if exist package-lock.json (
  echo Dang cai thu vien theo package-lock.json...
  npm ci
) else (
  echo Dang cai thu vien...
  npm install
)

if errorlevel 1 (
  echo.
  echo Cai thu vien loi. Kiem tra log npm phia tren.
  pause
  exit /b 1
)

echo.
echo Setup xong. Chay khoidong.bat de mo he thong.
pause
