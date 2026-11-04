@echo off
chcp 936 >nul
cd /d "%~dp0"
echo 启动「星河视界」局域网服务器…
echo 同一 WiFi 下的手机 / 电脑可以用下面打印的地址打开。
echo 注意：浏览器只在 https 或 localhost 下允许调摄像头，
echo       局域网 http 地址能看画面，但手势识别会被浏览器拦掉（鼠标模式照常可用）。
echo.

set NODE=node
where node >nul 2>nul
if not %errorlevel%==0 (
  if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" (
    set NODE="%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
  ) else (
    echo 没找到 Node.js，请先安装 Node。
    pause
    exit /b 1
  )
)

%NODE% server.mjs 8123 0.0.0.0
pause