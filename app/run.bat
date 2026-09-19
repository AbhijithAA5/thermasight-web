@echo off
rem ThermaSight - standalone launcher (Windows).
rem Installs dependencies, builds, and serves at http://localhost:3000
echo [ThermaSight] Installing dependencies (first run only)...
call npm install
if errorlevel 1 goto :err
echo [ThermaSight] Building the production bundle...
call npm run build
if errorlevel 1 goto :err
echo [ThermaSight] Serving at http://localhost:3000  (Ctrl+C to stop)
call npm run start
goto :eof
:err
echo Failed. ThermaSight needs Node.js 20+ (https://nodejs.org).
exit /b 1