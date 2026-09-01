param(
  [string]$BasePath = "C:\ProgramData\SpilledCinema\Convex",
  [int]$Keep = 7
)

$ErrorActionPreference = "Stop"
$taskPath = "\SpilledCinema\"
$taskName = "Convex Backend"
$dataPath = [IO.Path]::GetFullPath((Join-Path $BasePath "data"))
$backupRoot = [IO.Path]::GetFullPath((Join-Path $BasePath "backups\daily"))
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$destination = [IO.Path]::GetFullPath((Join-Path $backupRoot $timestamp))

if (-not $destination.StartsWith("$backupRoot\", [StringComparison]::OrdinalIgnoreCase)) {
  throw "Backup destination escaped the configured backup root."
}

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$backendWasRunning = (Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName).State -eq "Running"

try {
  if ($backendWasRunning) {
    Stop-ScheduledTask -TaskPath $taskPath -TaskName $taskName
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      if (-not (Get-NetTCPConnection -State Listen -LocalPort 3210 -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Seconds 1
    }
    if (Get-NetTCPConnection -State Listen -LocalPort 3210 -ErrorAction SilentlyContinue) {
      throw "Convex backend did not stop before backup."
    }
  }

  New-Item -ItemType Directory -Path $destination | Out-Null
  Copy-Item -LiteralPath $dataPath -Destination (Join-Path $destination "data") -Recurse
  Get-ChildItem -LiteralPath $destination -File -Recurse |
    Get-FileHash -Algorithm SHA256 |
    Select-Object Path, Hash |
    ConvertTo-Json -Depth 3 |
    Set-Content -LiteralPath (Join-Path $destination "manifest.json") -Encoding UTF8
} finally {
  if ($backendWasRunning) {
    Start-ScheduledTask -TaskPath $taskPath -TaskName $taskName
    $backendReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      if (Get-NetTCPConnection -State Listen -LocalPort 3210 -ErrorAction SilentlyContinue) {
        $backendReady = $true
        break
      }
      if ($attempt -gt 0 -and $attempt % 10 -eq 0) {
        Start-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue
      }
      Start-Sleep -Seconds 1
    }
    if (-not $backendReady) {
      throw "Convex backend did not recover after backup."
    }
  }
}

$oldBackups = Get-ChildItem -LiteralPath $backupRoot -Directory |
  Sort-Object Name -Descending |
  Select-Object -Skip ([Math]::Max(1, $Keep))
foreach ($oldBackup in $oldBackups) {
  $resolved = [IO.Path]::GetFullPath($oldBackup.FullName)
  if (-not $resolved.StartsWith("$backupRoot\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a backup outside the configured backup root: $resolved"
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
