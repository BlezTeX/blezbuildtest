@echo off
title Banditimo v0.0.6
echo Starting Banditimo v0.0.6...
echo.
echo Installing dependencies if needed...
call npm install
echo.
echo Starting server...
echo.
echo Local PC:
echo http://localhost:3000
echo.
echo Other devices on same WiFi/LAN can use the LAN IP shown by the server.
echo.
call npm start
pause
