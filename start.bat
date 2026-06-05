@echo off
cd /d %~dp0
title Banana Empire LAN Server 0.1.2
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS from https://nodejs.org/ first.
  pause
  exit /b 1
)
echo Starting Banana Empire LAN server 0.1.2...
echo No npm install needed. This version uses only built-in Node.js modules.
echo.
node server.js
pause
