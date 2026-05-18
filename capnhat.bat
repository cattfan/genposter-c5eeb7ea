@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "LOCAL_NODE=%~dp0.runtime\node"
set "PATH=%LOCAL_NODE%;%LOCAL_NODE%\node_modules\npm\bin;%ProgramFiles%\nodejs;%AppData%\npm;%PATH%"

echo.
echo =========================================
echo  GenPoster - Cap nhat phien ban moi nhat
echo =========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo Loi: Chua cai Git. Hay cai Git for Windows roi chay lai.
  echo Tai tai: https://git-scm.com/download/win
  pause
  exit /b 1
)

echo Dang kiem tra cap nhat tu GitHub...
echo.

git pull --ff-only
if errorlevel 1 (
  echo.
  echo Loi khi pull. Co the ban da chinh sua file local.
  echo Thu: git stash ^&^& git pull ^&^& git stash pop
  pause
  exit /b 1
)

echo.
echo Dang cap nhat thu vien frontend...
call npm install
if errorlevel 1 (
  echo Loi npm install frontend. Kiem tra log phia tren.
  pause
  exit /b 1
)

echo.
echo Dang cap nhat thu vien backend...
pushd backend
call npm install
echo Rebuild native modules cho Node hien tai...
call npm rebuild better-sqlite3 2>nul
popd
if errorlevel 1 (
  echo Loi npm install backend. Kiem tra log phia tren.
  pause
  exit /b 1
)

echo.
echo =========================================
echo  Cap nhat thanh cong!
echo  Chay khoidong.bat de su dung phien ban moi.
echo =========================================
echo.
pause
