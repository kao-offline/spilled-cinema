param([string]$BasePath = "C:\ProgramData\SpilledCinema\Convex")

$ErrorActionPreference = "Stop"
$binaryPath = Join-Path $BasePath "bin\cloudflared.exe"
$tokenPath = Join-Path $BasePath "secrets\tunnel-token.txt"
$logDirectory = Join-Path $BasePath "logs"
$logPath = Join-Path $logDirectory "cloudflared.log"

foreach ($requiredPath in @($binaryPath, $tokenPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required tunnel runtime file is missing: $requiredPath"
  }
}

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
while ($true) {
  & $binaryPath tunnel --no-autoupdate --loglevel info --logfile $logPath --metrics 127.0.0.1:20242 run --token-file $tokenPath
  $exitCode = $LASTEXITCODE
  Add-Content -LiteralPath $logPath -Value ("{0:o} cloudflared exited with code {1}; restarting in 5 seconds." -f [DateTimeOffset]::Now, $exitCode)
  if ((Get-Item -LiteralPath $logPath -ErrorAction SilentlyContinue).Length -gt 25MB) {
    Copy-Item -LiteralPath $logPath -Destination "$logPath.1" -Force
    Clear-Content -LiteralPath $logPath
  }
  Start-Sleep -Seconds 5
}
