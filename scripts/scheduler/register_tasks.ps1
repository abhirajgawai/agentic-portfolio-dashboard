# register_tasks.ps1 - M4: register the daily portfolio pipeline jobs in Windows
# Task Scheduler. Idempotent: /F force-overwrites any existing task with the
# same name, so re-running after an edit is safe.
#
# Schedule (times are MACHINE-LOCAL; the always-on box runs IST - PLAN.md M4):
#   09:35  PortfolioServeZerodha      daemon up, waits for the manual 2FA login
#   09:45  PortfolioSnapshotMorning   morning live snapshot
#   15:45  PortfolioSnapshotEod       EOD snapshot
#   15:50  PortfolioTrades            daily trade capture for XIRR
#   15:55  PortfolioExportJson        dashboard JSON export
#   21:30  PortfolioNavRefresh        AMFI NAV refresh (keyless)
#   21:35  PortfolioFxRefresh         FX refresh (keyless)
#
# Design notes:
#  - Tasks run as the current user (interactive, always-on desktop). No /RU or
#    /RP is passed: schtasks registers an interactive-only task for the current
#    user without storing a password.
#  - The pipeline commands carry their OWN calendar gate - holidays/weekends are
#    skipped and logged INSIDE the pipeline, so tasks fire DAILY with no day
#    filtering and no --force.
#  - /RL LIMITED = least privilege; the task never runs as admin.
#  - Each task runs its wrapper in scripts\scheduler\run_*.cmd, which calls the
#    venv python directly ("%ROOT%\.venv\Scripts\python.exe" -m portfolio.cli ...):
#    deterministic - no `uv run` re-sync, no console-script indirection.
#
# Reversal: run scripts\scheduler\unregister_tasks.ps1
# Inspect:  run scripts\scheduler\list_tasks.ps1
#Requires -Version 5.1

$ErrorActionPreference = 'Stop'

# Repo root, derived from this script's own location so it works from anywhere.
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$WrapperDir = Join-Path $Root 'scripts\scheduler'

# name -> @(start time HH:MM, wrapper file name)
$Tasks = [ordered]@{
    'PortfolioServeZerodha'    = @('09:35', 'run_serve.cmd')
    'PortfolioSnapshotMorning' = @('09:45', 'run_snapshot_morning.cmd')
    'PortfolioSnapshotEod'     = @('15:45', 'run_snapshot_eod.cmd')
    'PortfolioTrades'          = @('15:50', 'run_trades.cmd')
    'PortfolioExportJson'      = @('15:55', 'run_export.cmd')
    'PortfolioNavRefresh'      = @('21:30', 'run_nav.cmd')
    'PortfolioFxRefresh'       = @('21:35', 'run_fx.cmd')
}

Write-Host 'Registering portfolio pipeline tasks (daily, machine-local IST):'
foreach ($entry in $Tasks.GetEnumerator()) {
    $name = $entry.Key
    $time = $entry.Value[0]
    $wrapper = Join-Path $WrapperDir $entry.Value[1]
    if (-not (Test-Path -LiteralPath $wrapper)) {
        throw "wrapper not found: $wrapper"
    }
    # /TR = the full quoted path to the .cmd. Task Scheduler executes the batch
    # directly; the wrapper itself invokes the venv python. The repo path has no
    # spaces, so a plain quoted value round-trips cleanly through schtasks.
    & schtasks.exe /Create /TN $name /TR ('"{0}"' -f $wrapper) /SC DAILY /ST $time /F /RL LIMITED | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "schtasks failed for $name (exit $LASTEXITCODE)"
    }
    Write-Host ("  {0,-26} {1}  {2}" -f $name, $time, $wrapper)
}

Write-Host ''
Write-Host 'Registered tasks (schtasks, one query per exact task name):'
# NOTE: schtasks /Query /TN "Portfolio*" (wildcard) fails on this box with
# "The system cannot find the file specified" even when the tasks exist - a
# schtasks.exe quirk seen from both cmd.exe and PowerShell. Exact-name queries
# are reliable, so we iterate the 7 known names instead.
foreach ($name in $Tasks.Keys) {
    & schtasks.exe /Query /FO TABLE /TN $name
}
