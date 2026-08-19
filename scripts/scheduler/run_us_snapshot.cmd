@echo off
REM run_us_snapshot.cmd - Task Scheduler wrapper: mid-US-session LIVE snapshot (22:30 IST).
REM Task: PortfolioSnapshotUs. Fires daily; the NYSE gate (calendars.py, nyse_YYYY.json)
REM skips weekends/holidays with an audited runs row - no --force.
REM
REM Why 22:30 IST: it is ~13:00 ET (12:00 ET in US winter), inside the NYSE session
REM (09:30-16:00 ET), so this is the ONLY run in the all-IST schedule that captures
REM the US market WHILE IT IS OPEN. It refreshes the moomoo leg (positions + broker
REM day P&L vs the previous US close - real same-day P&L data).
REM
REM Ledger semantics (documented in PLAN.md M4): position_snapshot is
REM UNIQUE(snapshot_date, account_id, instrument_id) with ON CONFLICT DO UPDATE, so
REM this run OVERWRITES the moomoo row the 15:45 EOD run wrote for the same Kolkata
REM date (which held the previous US close, captured pre-open at 06:15 ET). The
REM daily US value therefore becomes the ~13:00 ET intraday price - fresher, and the
REM broker day P&L on that row is real. The follow-up 22:35 export (PortfolioExportJsonUs)
REM regenerates the dashboard JSONs, which trips the UI's reload banner.
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\data\logs" mkdir "%ROOT%\data\logs"
"%ROOT%\.venv\Scripts\python.exe" -m portfolio.cli snapshot --platform moomoo >> "%ROOT%\data\logs\us_snapshot.log" 2>&1