@echo off
chcp 936 >nul
cd /d "%~dp0"
echo 启动「星河视界」本地服务器...

where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://127.0.0.1:8123/
  node server.mjs 8123
  goto :eof
)

if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
  start "" http://127.0.0.1:8123/
  "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" server.mjs 8123
  goto :eof
)

echo 没找到 Node.js。请安装 Node，或用任意静态服务器打开本目录（注意 .mjs/.task 的 MIME 类型）。
pause
