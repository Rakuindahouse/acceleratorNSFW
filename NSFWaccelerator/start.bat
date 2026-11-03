@echo off
rem Launch as a Chrome (or Edge) app window that keeps rendering even when hidden or captured by OBS.
cd /d "%~dp0"
set FLAGS=--user-data-dir="%LOCALAPPDATA%\ebb-flow-mixer-browser" --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --autoplay-policy=no-user-gesture-required --window-size=1280,800
start "" chrome %FLAGS% --app="file:///%~dp0index.html"
if errorlevel 1 start "" msedge %FLAGS% --app="file:///%~dp0index.html"
