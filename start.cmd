@echo off
chcp 936 >nul
REM 黑喵子围棋 - 一键启动（构建前端 + 启动服务器）
setlocal
cd /d "%~dp0"
set "NODE_DIR=%~dp0.tools\node-v24.19.0-win-x64"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [错误] 未找到 Node.js。
  echo        请安装 Node.js 18+，或把便携版解压到 .tools\node-v24.19.0-win-x64
  echo.
  pause
  exit /b 1
)

echo 检查 5177 端口是否已被占用...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://localhost:5177/api/health' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo [提示] 服务器似乎已经在运行了！
  echo        直接打开浏览器访问 http://localhost:5177 即可。
  echo        若需重启：请先关闭正在运行的服务器窗口，再重新双击 start.cmd。
  echo.
  start http://localhost:5177
  pause
  exit /b 0
)

echo.
echo [1/2] 构建前端...
call npm run build -w client
if errorlevel 1 (
  echo [警告] 前端构建失败，仍将尝试启动后端服务。
  echo.
)

echo.
echo [2/2] 启动服务器...
echo       看到 "黑喵子围棋已启动" 后，浏览器打开 http://localhost:5177
echo       按 Ctrl+C 可停止服务器。
echo.
call npm run start -w server

echo.
echo [服务器已停止]（按任意键关闭窗口）
pause
endlocal
