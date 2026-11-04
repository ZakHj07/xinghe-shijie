@echo off
chcp 936 >nul
cd /d "%~dp0"

echo [1/3] 整理发布目录 dist\ …
if exist "dist" rmdir /s /q "dist"
mkdir "dist"

xcopy /y /q "index.html" "dist\" >nul
xcopy /y /q "README.md"  "dist\" >nul
xcopy /y /q "server.mjs" "dist\" >nul
xcopy /y /q "start.bat"  "dist\" >nul
xcopy /e /i /q /y "css"    "dist\css"    >nul
xcopy /e /i /q /y "js"     "dist\js"     >nul
xcopy /e /i /q /y "assets" "dist\assets" >nul
xcopy /e /i /q /y "vendor" "dist\vendor" >nul

echo [2/3] 打包 星河视界.zip …
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "if (Test-Path '星河视界.zip') { Remove-Item '星河视界.zip' -Force }; Compress-Archive -Path 'dist\*' -DestinationPath '星河视界.zip' -CompressionLevel Optimal"

echo [3/3] 完成，产物在这个目录里：
echo     dist\           整个网站（约 53 MB），可直接拖去托管
echo     星河视界.zip     打包好的压缩包（约 31 MB），可发给朋友
echo.
echo   dist\           → 整个文件夹拖到 https://app.netlify.com/drop 就能上线
echo   星河视界.zip    → 直接发给朋友，解压后双击 start.bat（需要 Node）
echo.
pause