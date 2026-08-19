@echo off
REM run_snapshot_morning.cmd - Task Scheduler wrapper: morning LIVE snapshot (09:45 IST).
REM Task: PortfolioSnapshotMorning. Fires daily; the pipeline's own calendar gate
REM skips holidays/weekends (logged inside the pipeline, not here) - no --force.
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\data\logs" mkdir "%ROOT%\data\logs"
"%ROOT%\.venv\Scripts\python.exe" -m portfolio.cli snapshot --platform all >> "%ROOT%\data\logs\snapshot_morning.log" 2>&1
