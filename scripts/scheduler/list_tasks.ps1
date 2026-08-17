# list_tasks.ps1 - M4: show the 7 registered Portfolio* tasks and verify that
# each task's action (the run_*.cmd wrapper path) resolves to a real file.
#
# Primary output: schtasks /Query /FO TABLE /TN "Portfolio*" - TaskName,
# Next Run Time, Status. Then, per task, the registered action path is read via
# Get-ScheduledTask and Test-Path'd, so a task pointing at a deleted/moved
# wrapper shows [MISSING] instead of silently failing at fire time.
#
# Exit code 0 when all 7 tasks exist with resolvable wrappers, 1 otherwise.
#Requires -Version 5.1

$TaskNames = @(
    'PortfolioServeZerodha',
    'PortfolioSnapshotMorning',
    'PortfolioSnapshotEod',
    'PortfolioTrades',
    'PortfolioNavRefresh',
    'PortfolioFxRefresh',
    'PortfolioExportJson'
)

Write-Host 'Portfolio* tasks (schtasks, one query per exact task name):'
# NOTE: schtasks /Query /TN "Portfolio*" (wildcard) fails on this box with
# "The system cannot find the file specified" even when the tasks exist - a
# schtasks.exe quirk seen from both cmd.exe and PowerShell. Exact-name queries
# are reliable, so we iterate the 7 known names instead.
foreach ($name in $TaskNames) {
    & schtasks.exe /Query /FO TABLE /TN $name
}

Write-Host ''
Write-Host 'Wrapper path verification (registered action -> Test-Path):'
$allOk = $true
foreach ($name in $TaskNames) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($null -eq $task -or $task.Actions.Count -eq 0) {
        Write-Host ("  {0,-26} NOT REGISTERED" -f $name)
        $allOk = $false
        continue
    }
    $execute = $task.Actions[0].Execute
    $ok = Test-Path -LiteralPath $execute -PathType Leaf
    if (-not $ok) {
        $allOk = $false
        Write-Host ("  {0,-26} {1}  [MISSING]" -f $name, $execute)
    } else {
        Write-Host ("  {0,-26} {1}  [OK]" -f $name, $execute)
    }
}

if (-not $allOk) {
    Write-Host ''
    Write-Host 'WARNING: one or more tasks are missing or point at a missing wrapper.'
    Write-Host 'Re-register with: powershell -ExecutionPolicy Bypass -File scripts\scheduler\register_tasks.ps1'
    exit 1
}
