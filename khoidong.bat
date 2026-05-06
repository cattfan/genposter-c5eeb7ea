@echo off
chcp 65001 >nul
setlocal EnableExtensions

cd /d "%~dp0"

set "APP_URL=http://localhost:9090"
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
echo  GenPoster - Khoi dong he thong
echo =========================================
echo.

if not exist package.json (
  set "ERROR_MSG=Khong thay package.json. Hay dat file nay trong thu muc goc du an."
  goto fail
)

where node >nul 2>nul
if errorlevel 1 (
  echo Chua co Node.js. Dang chay setup.bat de cai moi truong...
  call "%~dp0setup.bat" --no-pause
  if errorlevel 1 (
    set "ERROR_MSG=Setup tu dong khong thanh cong."
    goto fail
  )
  set "PATH=%LOCAL_NODE%;%LOCAL_NODE%\node_modules\npm\bin;%ProgramFiles%\nodejs;%AppData%\npm;%PATH%"
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Chua co npm. Dang chay setup.bat de cai moi truong...
  call "%~dp0setup.bat" --no-pause
  if errorlevel 1 (
    set "ERROR_MSG=Setup tu dong khong thanh cong."
    goto fail
  )
  set "PATH=%LOCAL_NODE%;%LOCAL_NODE%\node_modules\npm\bin;%ProgramFiles%\nodejs;%AppData%\npm;%PATH%"
)

echo Node:
node -v
echo npm:
call npm -v
echo.

node scripts\check-node.cjs
if errorlevel 1 (
  echo Node.js hien tai qua cu. Dang chay setup.bat de cai Node.js portable moi...
  call "%~dp0setup.bat" --no-pause
  if errorlevel 1 (
    set "ERROR_MSG=Setup tu dong khong thanh cong."
    goto fail
  )
  set "PATH=%LOCAL_NODE%;%LOCAL_NODE%\node_modules\npm\bin;%ProgramFiles%\nodejs;%AppData%\npm;%PATH%"
)

if not exist node_modules (
  echo Chua co node_modules. Dang chay setup.bat truoc...
  call "%~dp0setup.bat" --no-pause
  if errorlevel 1 (
    set "ERROR_MSG=Setup tu dong khong thanh cong."
    goto fail
  )
)

if defined CHECK_ONLY (
  echo Kiem tra khoi dong OK. Server se chay tai %APP_URL%.
  exit /b 0
)

netstat -ano | findstr /R /C:":9090 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo Port 9090 dang co server dang chay.
  echo Neu do la GenPoster, trinh duyet se mo lai ngay bay gio: %APP_URL%
  start "" "%APP_URL%"
  if not defined NO_PAUSE pause
  exit /b 0
)

echo Web se mo tai %APP_URL%
start "Mo GenPoster" powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3; Start-Process '%APP_URL%'"
echo.
echo Dang chay server. Dung tat cua so nay khi con dung app.
echo Nhan Ctrl+C de dung server.
echo.

call npm run dev

echo.
echo Server da dung.
if not defined NO_PAUSE pause
exit /b 0

:fail
echo.
echo Loi: %ERROR_MSG%
if not defined NO_PAUSE pause
exit /b 1
