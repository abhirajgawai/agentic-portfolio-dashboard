@echo off
REM run_cas_auto.cmd - Task Scheduler wrapper: full unattended CAS loop
REM (21:40 IST, docs/CAMS_KFINTECH_CAS_PLAN.md, Part B). Task: PortfolioCasAuto.
REM Fires daily WITHOUT --force: `portfolio cas auto` self-gates on the
REM UI-configurable cas_schedule table (default every 2 days) and writes an
REM audited 'skipped' row on days it's not due. When due: requests the
REM CAMS+KFintech CAS, waits for the email, downloads it, imports it, and
REM refreshes the dashboard exports - zero manual steps. Requires
REM `portfolio auth --platform cams` and `portfolio auth --platform gmail`
REM to already be configured.
setlocal
set "ROOT=%~dp0..\.."
if not exist "%ROOT%\data\logs" mkdir "%ROOT%\data\logs"
"%ROOT%\.venv\Scripts\python.exe" -m portfolio.cli cas auto >> "%ROOT%\data\logs\cas_auto.log" 2>&1
