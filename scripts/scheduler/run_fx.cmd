@echo off
REM run_fx.cmd - Task Scheduler wrapper: FX refresh (21:35 IST, keyless).
REM Task: PortfolioFxRefresh. One INR/USD (+SGD) rate per run via open.er-api.com,
REM persisted to fx_rates. A NEW `portfolio fx refresh` CLI command (added in M4
REM alongside this scheduler) provides it; the task only fires after that lands.
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\data\logs" mkdir "%ROOT%\data\logs"
"%ROOT%\.venv\Scripts\python.exe" -m portfolio.cli fx refresh >> "%ROOT%\data\logs\fx.log" 2>&1
