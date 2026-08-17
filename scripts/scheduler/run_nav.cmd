@echo off
REM run_nav.cmd - Task Scheduler wrapper: AMFI NAV refresh (21:30 IST, keyless).
REM Task: PortfolioNavRefresh. Prices CAS-derived MFs + ETFs from the official
REM AMFI NAVAll.txt feed, one fetch per run (FX-module pattern).
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\data\logs" mkdir "%ROOT%\data\logs"
"%ROOT%\.venv\Scripts\python.exe" -m portfolio.cli nav refresh >> "%ROOT%\data\logs\nav.log" 2>&1
