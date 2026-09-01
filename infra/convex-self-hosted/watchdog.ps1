param([string]$BasePath = "C:\ProgramData\SpilledCinema\Convex")

$ErrorActionPreference = "Stop"
$taskPath = "\SpilledCinema\"
$checks = @(
  @{ Task = "Convex Backend"; Port = 3210 },
  @{ Task = "Convex Tunnel"; Port = 0 }
)

foreach ($check in $checks) {
  $task = Get-ScheduledTask -TaskPath $taskPath -TaskName $check.Task -ErrorAction SilentlyContinue
  if (-not $task) { throw "Required task is missing: $($check.Task)" }
  $listening = $check.Port -eq 0 -or [bool](Get-NetTCPConnection -State Listen -LocalPort $check.Port -ErrorAction SilentlyContinue)
  if ($task.State -ne "Running" -or -not $listening) {
    if ($task.State -eq "Running") {
      Stop-ScheduledTask -TaskPath $taskPath -TaskName $check.Task -ErrorAction SilentlyContinue
    }
    Start-ScheduledTask -TaskPath $taskPath -TaskName $check.Task
  }
}
