param([string]$BasePath = "C:\ProgramData\SpilledCinema\Convex")

$ErrorActionPreference = "Stop"
$taskPath = "\SpilledCinema\"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$trigger = New-ScheduledTaskTrigger -AtStartup

$tasks = @(
  @{ Name = "Convex Backend"; Script = (Join-Path $BasePath "scripts\run-backend.ps1") },
  @{ Name = "Convex Tunnel"; Script = (Join-Path $BasePath "scripts\run-tunnel.ps1") }
)

foreach ($task in $tasks) {
  $arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$($task.Script)`" -BasePath `"$BasePath`""
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
  Register-ScheduledTask `
    -TaskName $task.Name `
    -TaskPath $taskPath `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null
}

$backupAction = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$(Join-Path $BasePath 'scripts\backup.ps1')`" -BasePath `"$BasePath`""
$backupTrigger = New-ScheduledTaskTrigger -Daily -At "04:15"
Register-ScheduledTask `
  -TaskName "Convex Backup" `
  -TaskPath $taskPath `
  -Action $backupAction `
  -Trigger $backupTrigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

Start-ScheduledTask -TaskPath $taskPath -TaskName "Convex Backend"
Start-ScheduledTask -TaskPath $taskPath -TaskName "Convex Tunnel"
