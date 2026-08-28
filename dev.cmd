@echo off
REM 黑喵子围棋 - 开发模式（前端热更新 + 后端自动重启）
setlocal
set "NODE_DIR=%~dp0.tools\node-v24.19.0-win-x64"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"
call npm run dev
endlocal
