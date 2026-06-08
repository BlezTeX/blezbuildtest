@echo off
title Banditimo v0.0.7
echo Starting Banditimo v0.0.7...
echo.
echo Installing dependencies if needed...
call npm install
echo.
echo Starting server...
echo.
echo Open on this PC:
echo http://localhost:3000
echo.
echo For LAN testing, use the LAN IP printed below after the server starts.
echo.
call npm start
pause
