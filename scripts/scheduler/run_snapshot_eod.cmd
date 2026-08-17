@echo off
REM run_snapshot_eod.cmd - Task Scheduler wrapper: EOD snapshot (15:45 IST).
REM Task: PortfolioSnapshotEod. Fires daily; the pipeline's own calendar gate
REM skips holidays/weekends (logged inside the pipeline, not here) - no --force.
REM --eod marks the run as end-of-day so the M8 trend series prices it.
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\data\logs" mkdir "%ROOT%\data\logs"
"%ROOT%\.venv\Scripts\python.exe" -m portfolio.cli snapshot --all --eod >> "%ROOT%\data\logs\snapshot_eod.log" 2>&1
