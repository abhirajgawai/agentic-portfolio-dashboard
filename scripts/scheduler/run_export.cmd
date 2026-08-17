@echo off
REM run_export.cmd - Task Scheduler wrapper: dashboard JSON export (15:55 IST).
REM Task: PortfolioExportJson. Runs scripts/export_json.py (deterministic, M8
REM contract: latest.json + history.json) with the venv python - the one wrapper
REM that runs a script file rather than -m portfolio.cli.
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\data\logs" mkdir "%ROOT%\data\logs"
"%ROOT%\.venv\Scripts\python.exe" "%ROOT%\scripts\export_json.py" >> "%ROOT%\data\logs\export.log" 2>&1
