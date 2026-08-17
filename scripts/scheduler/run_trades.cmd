@echo off
REM run_trades.cmd - Task Scheduler wrapper: daily trade capture (15:50 IST).
REM Task: PortfolioTrades. Feeds XIRR (M5): Kite order/trade history is same-day
REM only, so trades must be captured daily going forward.
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\data\logs" mkdir "%ROOT%\data\logs"
"%ROOT%\.venv\Scripts\python.exe" -m portfolio.cli trades >> "%ROOT%\data\logs\trades.log" 2>&1
