@echo off
rem Launch in a dedicated Chrome (or Edge) window that keeps rendering even when hidden or captured by OBS.
cd /d "%~dp0"
set FLAGS=--user-data-dir="%LOCALAPPDATA%\ebb-flow-mixer-browser" --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --autoplay-policy=no-user-gesture-required --new-window
start "" chrome %FLAGS% "%~dp0index.html"
if errorlevel 1 start "" msedge %FLAGS% "%~dp0index.html"
