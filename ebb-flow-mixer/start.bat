@echo off
rem ebb flow mixer を起動します（ローカルサーバー + ブラウザ）
cd /d "%~dp0"
set PORT=8787
start "" cmd /c "timeout /t 2 >nul & start http://localhost:%PORT%/"
where py >nul 2>nul && (py -m http.server %PORT% & goto :eof)
where python >nul 2>nul && (python -m http.server %PORT% & goto :eof)
where npx >nul 2>nul && (npx --yes http-server -p %PORT% -c-1 & goto :eof)
echo Python か Node.js をインストールしてください。
pause
