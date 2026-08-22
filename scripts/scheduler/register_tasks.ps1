# register_tasks.ps1 - M4: register the daily portfolio pipeline jobs in Windows
# Task Scheduler. Idempotent: /F force-overwrites any existing task with the
# same name, so re-running after an edit is safe.
#
# Schedule (triggers are TIMEZONE-ANCHORED to IST, +05:30 - the StartBoundary
# carries the offset, so each task fires at the same absolute instant no matter
# what timezone the host is in. The host is currently UTC+8 (Singapore), so the
# same instants read 12:05 / 12:15 / ... in machine-local terms):
#   09:35 IST  PortfolioServeZerodha       daemon up, waits for the manual 2FA login
#   09:45 IST  PortfolioSnapshotMorning    morning live snapshot (IN leg; US leg self-gates)
#   09:50 IST  PortfolioExportJsonMorning  dashboard JSON export (the morning "refresh")
#   15:45 IST  PortfolioSnapshotEod        EOD snapshot
#   15:50 IST  PortfolioTrades             daily trade capture for XIRR
#   16:15 IST  PortfolioExportJson         dashboard JSON export (EOD) — 30 min buffer after EOD
#   21:30 IST  PortfolioNavRefresh         AMFI NAV refresh (keyless)
#   21:35 IST  PortfolioFxRefresh          FX refresh (keyless)
#   22:30 IST  PortfolioSnapshotUs         mid-US-session LIVE snapshot (moomoo only; ~13:00 ET)
#   22:35 IST  PortfolioExportJsonUs       dashboard JSON export (US refresh - trips the reload banner)
#
# Design notes:
#  - Tasks run as the current user (interactive, always-on desktop). No /RU or
#    /RP is passed: the XML principal uses InteractiveToken + LeastPrivilege,
#    so no password is stored and the task never runs as admin.
#  - The pipeline commands carry their OWN calendar gate - holidays/weekends are
#    skipped and logged INSIDE the pipeline, so tasks fire DAILY with no day
#    filtering and no --force.
#  - Laptop-friendly settings: StartWhenAvailable (a missed trigger fires on the
#    next wake instead of being silently skipped with 0x800710E0) and battery is
#    allowed (DisallowStartIfOnBatteries/StopIfGoingOnBatteries = false).
#  - Each task runs its wrapper in scripts\scheduler\run_*.cmd, which calls the
#    venv python directly ("%ROOT%\.venv\Scripts\python.exe" -m portfolio.cli ...):
#    deterministic - no `uv run` re-sync, no console-script indirection.
#  - Registered via /XML (not /ST) because /ST only accepts MACHINE-LOCAL times:
#    an IST-anchored schedule needs the offset on StartBoundary.
#
# Reversal: run scripts\scheduler\unregister_tasks.ps1
# Inspect:  run scripts\scheduler\list_tasks.ps1
#Requires -Version 5.1

$ErrorActionPreference = 'Stop'

# Repo root, derived from this script's own location so it works from anywhere.
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$WrapperDir = Join-Path $Root 'scripts\scheduler'

# StartBoundary date (daily repetition makes it a start-anchor; use today).
$Today = (Get-Date).ToString('yyyy-MM-dd')

# name -> @(start time HH:MM IST, wrapper file name)
$Tasks = [ordered]@{
    'PortfolioServeZerodha'       = @('09:35', 'run_serve.cmd')
    'PortfolioSnapshotMorning'    = @('09:45', 'run_snapshot_morning.cmd')
    'PortfolioExportJsonMorning'  = @('09:50', 'run_export.cmd')
    'PortfolioSnapshotEod'        = @('15:45', 'run_snapshot_eod.cmd')
    'PortfolioTrades'             = @('15:50', 'run_trades.cmd')
    'PortfolioExportJson'         = @('16:15', 'run_export.cmd')
    'PortfolioNavRefresh'         = @('21:30', 'run_nav.cmd')
    'PortfolioFxRefresh'          = @('21:35', 'run_fx.cmd')
    'PortfolioSnapshotUs'         = @('22:30', 'run_us_snapshot.cmd')
    'PortfolioExportJsonUs'       = @('22:35', 'run_export.cmd')
}

function New-TaskXml {
    param(
        [string]$Name,
        [string]$IstTime,      # HH:MM
        [string]$Wrapper       # full path to the run_*.cmd
    )
    # StartBoundary carries the +05:30 offset => the trigger is an absolute IST
    # instant, independent of the machine's own timezone.
    $startBoundary = "${Today}T${IstTime}:00+05:30"
    $desc = "portfolio pipeline: $Name at $IstTime IST"
    @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>$desc</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT3H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$Wrapper</Command>
    </Exec>
  </Actions>
</Task>
"@
}

Write-Host "Registering $($Tasks.Count) portfolio pipeline tasks (daily, IST-anchored +05:30):"
$xmlDir = Join-Path $env:TEMP 'portfolio-scheduler-xml'
New-Item -ItemType Directory -Path $xmlDir -Force | Out-Null

try {
    foreach ($entry in $Tasks.GetEnumerator()) {
        $name = $entry.Key
        $istTime = $entry.Value[0]
        $wrapper = Join-Path $WrapperDir $entry.Value[1]
        if (-not (Test-Path -LiteralPath $wrapper)) {
            throw "wrapper not found: $wrapper"
        }
        # schtasks requires the XML file in UTF-16.
        $xmlFile = Join-Path $xmlDir "$name.xml"
        (New-TaskXml -Name $name -IstTime $istTime -Wrapper $wrapper) |
            Set-Content -LiteralPath $xmlFile -Encoding Unicode
        & schtasks.exe /Create /TN $name /XML $xmlFile /F | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "schtasks failed for $name (exit $LASTEXITCODE)"
        }
        Write-Host ("  {0,-28} {1} IST  {2}" -f $name, $istTime, $wrapper)
    }
} finally {
    Remove-Item -LiteralPath $xmlDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Registered tasks (schtasks, one query per exact task name):'
# NOTE: schtasks /Query /TN "Portfolio*" (wildcard) fails on this box with
# "The system cannot find the file specified" even when the tasks exist - a
# schtasks.exe quirk seen from both cmd.exe and PowerShell. Exact-name queries
# are reliable, so we iterate the known names instead.
foreach ($name in $Tasks.Keys) {
    & schtasks.exe /Query /FO TABLE /TN $name
}
