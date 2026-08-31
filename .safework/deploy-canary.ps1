$ErrorActionPreference = "Stop"

$serverExe = "C:\Users\kao\AppData\Local\Programs\Spilled Server\Spilled Server.exe"
$verifierExe = "C:\Users\kao\AppData\Local\Programs\Spilled Verifier\Spilled Verifier.exe"
$releaseDir = "C:\Users\kao\AppData\Local\Temp\SpilledCinema-release-0.2.0-beta.38"
$serverInstaller = Join-Path $releaseDir "Spilled-Server-Setup-0.2.0-beta.38-x64.exe"
$verifierInstaller = Join-Path $releaseDir "Spilled-Verifier-Setup-1.1.8-x64.exe"

$hashes = Get-FileHash -LiteralPath $serverInstaller, $verifierInstaller -Algorithm SHA256
if ($hashes[0].Hash -ne "6024EE412C881B1C85CD8D470FEAC288C30812F65628AA30F5E676834C6B2AF5") {
  throw "Server installer hash mismatch"
}
if ($hashes[1].Hash -ne "FAA0DCD02819119B675F2F1DDF251BE3F4D29BAC748A1F4D77AAA8DA3FBCE0F8") {
  throw "Verifier installer hash mismatch"
}

foreach ($taskName in @("Spilled Server Runtime", "Spilled Verifier Runtime")) {
  Stop-ScheduledTask -TaskName $taskName -TaskPath "\" -ErrorAction SilentlyContinue
}
$targets = Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -eq $serverExe -or
  $_.ExecutablePath -eq $verifierExe -or
  ($_.Name -eq "cloudflared.exe" -and $_.ExecutablePath -like "C:\Users\kao\AppData\Local\Programs\Spilled Server\*")
}
foreach ($target in $targets) {
  Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 3

$serverInstall = Start-Process -FilePath $serverInstaller -ArgumentList "/S" -Wait -PassThru
if ($serverInstall.ExitCode -ne 0) { throw "Server installer failed: $($serverInstall.ExitCode)" }
$verifierInstall = Start-Process -FilePath $verifierInstaller -ArgumentList "/S" -Wait -PassThru
if ($verifierInstall.ExitCode -ne 0) { throw "Verifier installer failed: $($verifierInstall.ExitCode)" }

$tasksBeforeStart = foreach ($taskName in @("Spilled Server Runtime", "Spilled Verifier Runtime")) {
  $task = Get-ScheduledTask -TaskName $taskName -TaskPath "\"
  [pscustomobject]@{
    Name = $taskName
    State = [string]$task.State
    RestartCount = $task.Settings.RestartCount
    RestartInterval = [string]$task.Settings.RestartInterval
    DisallowBattery = $task.Settings.DisallowStartIfOnBatteries
    StopOnBattery = $task.Settings.StopIfGoingOnBatteries
    Arguments = $task.Actions.Arguments
    TriggerCount = $task.Triggers.Count
  }
}

Start-ScheduledTask -TaskName "Spilled Server Runtime" -TaskPath "\"
Start-ScheduledTask -TaskName "Spilled Verifier Runtime" -TaskPath "\"
Start-Sleep -Seconds 25

$statusCode = try {
  (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8787/v2/health/ready" -TimeoutSec 10).StatusCode
} catch {
  "ERROR: $($_.Exception.Message)"
}
$config = Get-Content "C:\Users\kao\AppData\Roaming\Spilled Verifier\config.json" -Raw | ConvertFrom-Json
[pscustomobject]@{
  ServerInstaller = $serverInstall.ExitCode
  VerifierInstaller = $verifierInstall.ExitCode
  ServerStatus = $statusCode
  VerifierConfig = [pscustomobject]@{
    ControlPlaneUrl = $config.controlPlaneUrl
    GatewayUrl = $config.gatewayUrl
    SecretPresent = ([string]$config.controlPlaneSecret).Length -gt 0
  }
  Tasks = @($tasksBeforeStart)
} | ConvertTo-Json -Depth 6
