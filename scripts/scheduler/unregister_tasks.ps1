# unregister_tasks.ps1 - M4 reversal: delete the Portfolio* scheduled tasks
# created by register_tasks.ps1. Idempotent: a task that does not exist is
# skipped with a notice, not an error (the schtasks stderr for a missing task
# is discarded). Re-register anytime with register_tasks.ps1.
#Requires -Version 5.1

$TaskNames = @(
    'PortfolioServeZerodha',
    'PortfolioExportJsonMorning',
    'PortfolioTrades',
    'PortfolioNavRefresh',
    'PortfolioFxRefresh',
    'PortfolioCasAuto',
    'PortfolioExportJsonUs',
    'PortfolioExportJson'
)

# Obsolete live-snapshot tasks (removed 2026-08-27 - see register_tasks.ps1):
# listed separately so this script still cleans them up on a machine where
# they're still registered from before the change, without re-adding them
# to the canonical list above.
$ObsoleteTaskNames = @(
    'PortfolioSnapshotMorning',
    'PortfolioSnapshotEod',
    'PortfolioSnapshotUs'
)

$AllTaskNames = $TaskNames + $ObsoleteTaskNames

foreach ($name in $AllTaskNames) {
    & schtasks.exe /Delete /TN $name /F 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "deleted: $name"
    } else {
        Write-Host "not found - skipping: $name"
    }
}

Write-Host ''
# Final state check - per exact name again: schtasks wildcard /TN queries are
# unreliable on this box (see register_tasks.ps1), and a missing task makes an
# exact query exit 1, which is exactly how we detect "removed".
$remaining = foreach ($name in $AllTaskNames) {
    & schtasks.exe /Query /FO TABLE /TN $name 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $name }
}
if ($remaining) {
    Write-Host ("Still registered: {0}" -f ($remaining -join ', '))
} else {
    Write-Host "All $($AllTaskNames.Count) Portfolio* tasks removed."
}
