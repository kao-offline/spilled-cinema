$ErrorActionPreference = "Stop"

$taskName = "Spilled Server Runtime"
$serverExe = "C:\Users\kao\AppData\Local\Programs\Spilled Server\Spilled Server.exe"
$installRoot = "C:\Users\kao\AppData\Local\Programs\Spilled Server"
$installer = "C:\Users\kao\AppData\Local\Temp\SpilledCinema-release-0.2.0-beta.40\Spilled-Server-Setup-0.2.0-beta.40-x64.exe"
$expectedHash = "A8E9BB9F82C452788836C47884A4499B89C073C86E0D6E8DDB86D39E5267F35A"
$expectedNodeId = "node_b9909ae5609efe5f05d5d53d"
$configPath = "C:\Users\kao\AppData\Local\SpilledCinema\Server\data\spilled.private.json"

$actualHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) { throw "Server installer hash mismatch." }
$configHashBefore = if (Test-Path -LiteralPath $configPath) {
  (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
} else { "missing" }

Stop-ScheduledTask -TaskName $taskName -TaskPath "\" -ErrorAction SilentlyContinue
$targets = Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -eq $serverExe -or
  ($_.Name -eq "cloudflared.exe" -and $_.ExecutablePath -like "$installRoot\*")
}
foreach ($target in $targets) {
  Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 3

$install = Start-Process -FilePath $installer -ArgumentList "/S" -WindowStyle Hidden -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "Server installer failed: $($install.ExitCode)" }

$task = Get-ScheduledTask -TaskName $taskName -TaskPath "\"
Start-ScheduledTask -TaskName $taskName -TaskPath "\"

$status = $null
$attemptErrors = @()
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/status" -TimeoutSec 5
    if ($status.status -eq "ok") { break }
  } catch {
    $attemptErrors += $_.Exception.Message
  }
  Start-Sleep -Seconds 1
}
if (-not $status -or $status.status -ne "ok") {
  throw "Server did not become healthy after beta.40 installation. Last error: $($attemptErrors[-1])"
}
if ($status.node.nodeId -ne $expectedNodeId) {
  throw "Node identity changed: $($status.node.nodeId)"
}

$probeResults = for ($probe = 0; $probe -lt 12; $probe++) {
  $sample = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/status" -TimeoutSec 5
  [pscustomobject]@{
    Status = $sample.status
    NodeId = $sample.node.nodeId
    ConnectionCode = $sample.node.connectionCode
    NetworkName = $sample.node.networkName
    SetupRequired = $sample.auth.setupRequired
  }
}
$configHashAfter = if (Test-Path -LiteralPath $configPath) {
  (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
} else { "missing" }

[pscustomobject]@{
  InstallerExit = $install.ExitCode
  InstallerHash = $actualHash
  TaskState = [string](Get-ScheduledTask -TaskName $taskName -TaskPath "\").State
  RestartCount = $task.Settings.RestartCount
  ConfigPreserved = $configHashBefore -eq $configHashAfter
  HealthyProbes = @($probeResults | Where-Object { $_.Status -eq "ok" -and $_.NodeId -eq $expectedNodeId }).Count
  Final = $probeResults[-1]
} | ConvertTo-Json -Depth 4
