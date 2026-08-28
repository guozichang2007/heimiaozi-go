@echo off
REM 引擎配置检查（列出版本、后端、模型）
setlocal
set "NODE_DIR=%~dp0.tools\node-v24.19.0-win-x64"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"

echo ===================== Node =====================
node --version
echo ===================== 引擎后端 =====================
set "BIN=server\data\opencl\katago.exe"
if not exist "%BIN%" set "BIN=server\data\cuda\katago.exe"
if exist "%BIN%" (
  echo 使用引擎: %BIN%
  "%BIN%" version
) else (
  echo [警告] 未找到 Katago 可执行文件
)
echo ===================== 模型 =====================
dir /b server\data\*.bin.gz 2>nul
echo ===================== DeepSeek =====================
findstr /c:"DEEPSEEK_API_KEY=sk" server\.env >nul 2>nul && echo API Key: 已配置 || echo API Key: 未配置（黑喵子将离线）
pause
