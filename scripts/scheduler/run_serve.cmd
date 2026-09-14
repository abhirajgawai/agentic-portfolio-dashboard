@echo off
REM run_serve.cmd - Task Scheduler wrapper for the Zerodha session daemon (09:35 IST).
REM Task: PortfolioServeZerodha. Register via register_tasks.ps1, remove via
REM unregister_tasks.ps1. BLOCKS all day BY DESIGN: it holds the one authenticated
REM MCP connection for the trading day and waits for the daily MANUAL browser 2FA
REM login (guardrail #3 - never automate login). Snapshots reach it over the
REM loopback RPC on 127.0.0.1:8788.
REM --gate: the serve command exits 0 quietly on non-IN-trading days (weekends/
REM holidays) WITHOUT launching the daemon or prompting the 2FA login - the task
REM still fires daily, and a holiday is a normal no-op (see `portfolio serve --help`).
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\data\logs" mkdir "%ROOT%\data\logs"
"%ROOT%\.venv\Scripts\python.exe" -m portfolio.cli serve --platform zerodha --gate >> "%ROOT%\data\logs\serve.log" 2>&1
