@echo off
setlocal
rem Launch NSFWaccelerator as a Chrome (or Edge) app window.
cd /d "%~dp0"

if not exist "%~dp0index.html" (
  echo [ERROR] index.html was not found next to start.bat.
  echo Extract the ZIP first, then run start.bat inside the NSFWaccelerator folder.
  pause
  exit /b 1
)

set "BROWSER="
for %%P in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
  if not defined BROWSER if exist "%%~P" set "BROWSER=%%~P"
)

set "APPURL=file:///%~dp0index.html"
set "APPURL=%APPURL:\=/%"
set "PROFILE=%LOCALAPPDATA%\NSFWaccelerator-app"

echo Browser : %BROWSER%
echo App     : %APPURL%

if not defined BROWSER (
  echo Chrome / Edge not found. Opening index.html with the default browser.
  start "" "%~dp0index.html"
  timeout /t 5 >nul
  exit /b 0
)

start "" "%BROWSER%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --autoplay-policy=no-user-gesture-required --window-size=1280,800 --app="%APPURL%"
timeout /t 5 >nul
