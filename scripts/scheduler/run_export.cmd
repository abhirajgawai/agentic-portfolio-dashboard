@echo off
REM run_export.cmd - Task Scheduler wrapper: dashboard JSON export.
REM Task: PortfolioExportJsonMorning (09:50 IST), PortfolioExportJson (15:55 IST)
REM and PortfolioExportJsonUs (22:35 IST - the US mid-session refresh).
REM Runs scripts/export_json.py (deterministic, M8) - regenerates the 5 JSON
REM contract files the dashboard reads (latest/history/xirr/alerts/performance)
REM plus the alert evaluation. One shared wrapper for all three slots.
REM contract: latest.json + history.json) with the venv python - the one wrapper
REM that runs a script file rather than -m portfolio.cli.
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\data\logs" mkdir "%ROOT%\data\logs"
"%ROOT%\.venv\Scripts\python.exe" "%ROOT%\scripts\export_json.py" >> "%ROOT%\data\logs\export.log" 2>&1
