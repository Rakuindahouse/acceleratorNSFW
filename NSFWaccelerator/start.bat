@echo off
rem Launch NSFWaccelerator as a Chrome (or Edge) app window.
rem Uses its own browser profile so it keeps rendering when hidden or captured by OBS.
cd /d "%~dp0"
set "APPURL=file:///%~dp0index.html"
set "APPURL=%APPURL:\=/%"
set "PROFILE=%LOCALAPPDATA%\NSFWaccelerator-browser"
set FLAGS=--user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --autoplay-policy=no-user-gesture-required --window-size=1280,800
start "" chrome %FLAGS% --app="%APPURL%"
if errorlevel 1 start "" msedge %FLAGS% --app="%APPURL%"
if errorlevel 1 start "" "%~dp0index.html"
