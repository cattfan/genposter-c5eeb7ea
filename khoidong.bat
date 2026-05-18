@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

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
echo  Backend (NestJS + SQLite): http://localhost:3001
echo  Frontend (Vite):            %APP_URL%
echo  API Docs (Swagger):         http://localhost:3001/api/docs
echo  Du lieu:                    backend\data\genposter.db
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

if not exist node_modules (
  echo Chua co node_modules cho frontend. Dang chay setup.bat...
  call "%~dp0setup.bat" --no-pause
  if errorlevel 1 (
    set "ERROR_MSG=Setup tu dong khong thanh cong."
    goto fail
  )
)

if not exist backend\node_modules (
  echo Chua co node_modules cho backend. Dang chay setup.bat...
  call "%~dp0setup.bat" --no-pause
  if errorlevel 1 (
    set "ERROR_MSG=Setup tu dong khong thanh cong."
    goto fail
  )
)

if not exist backend\data mkdir backend\data
if not exist backend\data\blobs mkdir backend\data\blobs

REM Auto-rebuild native modules khi Node version thay doi (tranh ERR_DLOPEN_FAILED)
for /f "tokens=*" %%v in ('node -v') do set "CURRENT_NODE_VER=%%v"
set "NODE_VER_FILE=backend\data\.node-version"
set "NEED_REBUILD=0"
if not exist "%NODE_VER_FILE%" set "NEED_REBUILD=1"
if exist "%NODE_VER_FILE%" (
  set /p LAST_NODE_VER=<"%NODE_VER_FILE%"
  if not "!LAST_NODE_VER!"=="%CURRENT_NODE_VER%" set "NEED_REBUILD=1"
)
if "%NEED_REBUILD%"=="1" (
  echo Node version thay doi (%CURRENT_NODE_VER%). Rebuild native modules...
  pushd backend
  call npm rebuild better-sqlite3 2>nul
  popd
  echo %CURRENT_NODE_VER%>"%NODE_VER_FILE%"
)

if defined CHECK_ONLY (
  echo Kiem tra khoi dong OK. Server se chay tai %APP_URL%.
  exit /b 0
)

echo Node:
node -v
echo npm:
call npm -v
echo.

REM Kiem tra port 3001 (backend) va 9090 (frontend) chua bi chiem.
netstat -ano | findstr /R /C:":3001 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo CANH BAO: Port 3001 da co ung dung khac. Backend co the la GenPoster cu hoac khong.
  echo Thu mo trinh duyet truoc khi khoi dong moi: %APP_URL%
  start "" "%APP_URL%"
  if not defined NO_PAUSE pause
  exit /b 0
)

netstat -ano | findstr /R /C:":9090 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo Port 9090 da co server dang chay.
  start "" "%APP_URL%"
  if not defined NO_PAUSE pause
  exit /b 0
)

echo [1/2] Khoi dong backend NestJS port 3001 ...
start "GenPoster Backend" cmd /k "cd /d %~dp0backend && npm run dev"

REM Doi backend listen truoc khi khoi dong frontend (NestJS init khoang 5-10s).
echo Doi backend san sang ...
set "BACKEND_READY=0"
for /L %%i in (1,1,30) do (
  timeout /t 1 /nobreak >nul
  netstat -ano | findstr /R /C:":3001 .*LISTENING" >nul 2>nul
  if not errorlevel 1 (
    set "BACKEND_READY=1"
    goto backend_ready
  )
)

:backend_ready
if "%BACKEND_READY%"=="0" (
  echo CANH BAO: Backend chua listen sau 30s, frontend co the proxy /api fail.
)

echo [2/2] Khoi dong frontend Vite port 9090 ...
start "GenPoster Frontend" cmd /k "cd /d %~dp0 && npm run dev"

echo.
echo Doi frontend san sang ...
set "FRONTEND_READY=0"
for /L %%i in (1,1,30) do (
  timeout /t 1 /nobreak >nul
  netstat -ano | findstr /R /C:":9090 .*LISTENING" >nul 2>nul
  if not errorlevel 1 (
    set "FRONTEND_READY=1"
    goto frontend_ready
  )
)

:frontend_ready
if "%FRONTEND_READY%"=="1" (
  start "" "%APP_URL%"
  echo Da mo trinh duyet.
) else (
  echo CANH BAO: Frontend chua listen sau 30s. Mo thu cong: %APP_URL%
)

echo.
echo Backend va frontend dang chay o 2 cua so cmd rieng.
echo De tat: dong 2 cua so "GenPoster Backend" va "GenPoster Frontend".
echo Cua so nay co the dong an toan.
echo.
if not defined NO_PAUSE pause
exit /b 0

:fail
echo.
echo Loi: %ERROR_MSG%
if not defined NO_PAUSE pause
exit /b 1
