@echo off
chcp 65001 >nul
setlocal EnableExtensions

cd /d "%~dp0"

set "NO_PAUSE="
set "CHECK_ONLY="
set "LOCAL_NODE=%~dp0.runtime\node"
set "PATH=%LOCAL_NODE%;%LOCAL_NODE%\node_modules\npm\bin;%ProgramFiles%\nodejs;%AppData%\npm;%PATH%"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"
if /I "%~1"=="--check" (
  set "CHECK_ONLY=1"
  set "NO_PAUSE=1"
)
shift
goto parse_args

:args_done
echo.
echo =========================================
echo  GenPoster - Setup moi truong
echo =========================================
echo.

if not exist package.json (
  set "ERROR_MSG=Khong thay package.json. Hay dat file nay trong thu muc goc du an."
  goto fail
)

where node >nul 2>nul
if errorlevel 1 (
  echo Chua thay Node.js. Setup se tu tai Node.js portable cho du an...
  goto install_node
)

node scripts\check-node.cjs
if errorlevel 1 (
  echo Node.js hien tai khong phu hop. Setup se tu tai Node.js portable moi...
  goto install_node
)

goto node_ready

:install_node
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-node-lts.ps1"
if errorlevel 1 (
  set "ERROR_MSG=Khong cai duoc Node.js portable. Hay kiem tra mang/PowerShell roi chay setup.bat lai."
  goto fail
)

set "PATH=%LOCAL_NODE%;%LOCAL_NODE%\node_modules\npm\bin;%ProgramFiles%\nodejs;%AppData%\npm;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  set "ERROR_MSG=Van chua nhan Node.js. Hay dong cua so nay, mo lai roi chay setup.bat lan nua."
  goto fail
)

where npm >nul 2>nul
if errorlevel 1 (
  set "ERROR_MSG=Khong thay npm. Hay cai lai Node.js LTS roi chay setup.bat lan nua."
  goto fail
)

:node_ready
echo Node:
node -v
echo npm:
call npm -v
echo.

node scripts\check-node.cjs
if errorlevel 1 (
  set "ERROR_MSG=Node.js hien tai qua cu hoac khong nam trong nhom Vite ho tro."
  goto fail
)

if defined CHECK_ONLY (
  echo Kiem tra setup OK. May nay du Node.js/npm de cai va chay GenPoster.
  exit /b 0
)

echo Dang cai thu vien bang npm install...
call npm install

if errorlevel 1 (
  echo.
  echo npm install bi loi. Dang kiem tra cache npm roi thu lai voi --legacy-peer-deps...
  call npm cache verify
  call npm install --legacy-peer-deps
)

if errorlevel 1 (
  set "ERROR_MSG=Cai thu vien loi. Kiem tra log npm phia tren."
  goto fail
)

echo.
echo Setup xong. Chay khoidong.bat de mo he thong.
if not defined NO_PAUSE pause
exit /b 0

:fail
echo.
echo Loi: %ERROR_MSG%
if not defined NO_PAUSE pause
exit /b 1
