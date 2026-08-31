param(
  [string]$BasePath = "C:\ProgramData\SpilledCinema\Convex",
  [string]$ConvexSiteOrigin = "https://spilled-control-plane.hrdykrystof.workers.dev"
)

$ErrorActionPreference = "Stop"
$instanceName = "spilled-control-plane"
$binaryPath = Join-Path $BasePath "bin\convex-local-backend.exe"
$secretPath = Join-Path $BasePath "secrets\instance-secret.txt"
$databasePath = Join-Path $BasePath "data\convex.sqlite3"
$storagePath = Join-Path $BasePath "data\storage"
$logDirectory = Join-Path $BasePath "logs"
$logPath = Join-Path $logDirectory "backend.log"
$maxLogBytes = 25MB
$maxBackups = 5

foreach ($requiredPath in @($binaryPath, $secretPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required Convex runtime file is missing: $requiredPath"
  }
}

New-Item -ItemType Directory -Force -Path (Split-Path $databasePath), $storagePath, $logDirectory | Out-Null
$instanceSecret = (Get-Content -LiteralPath $secretPath -Raw).Trim()
if ($instanceSecret -notmatch "^[0-9a-f]{64}$") {
  throw "The Convex instance secret has an invalid format."
}

function Open-LogWriter {
  $utf8 = [Text.UTF8Encoding]::new($false)
  return [IO.StreamWriter]::new($logPath, $true, $utf8)
}

function Rotate-Log {
  param([IO.StreamWriter]$Writer)
  $Writer.Flush()
  $Writer.Dispose()
  for ($index = $maxBackups - 1; $index -ge 1; $index--) {
    $source = "$logPath.$index"
    $destination = "$logPath.$($index + 1)"
    if (Test-Path -LiteralPath $source) {
      Move-Item -LiteralPath $source -Destination $destination -Force
    }
  }
  if (Test-Path -LiteralPath $logPath) {
    Move-Item -LiteralPath $logPath -Destination "$logPath.1" -Force
  }
  return Open-LogWriter
}

$arguments = @(
  "--interface", "127.0.0.1",
  "--port", "3210",
  "--site-proxy-port", "3211",
  "--convex-origin", "http://127.0.0.1:3210",
  "--convex-site", $ConvexSiteOrigin,
  "--instance-name", $instanceName,
  "--instance-secret", $instanceSecret,
  "--local-storage", $storagePath,
  "--redact-logs-to-client",
  "--disable-beacon",
  $databasePath
)

while ($true) {
  $writer = Open-LogWriter
  try {
    $writer.WriteLine("{0:o} Starting Convex backend." -f [DateTimeOffset]::Now)
    $writer.Flush()
    & $binaryPath @arguments 2>&1 | ForEach-Object {
      if ($writer.BaseStream.Length -ge $maxLogBytes) {
        $writer = Rotate-Log -Writer $writer
      }
      $writer.WriteLine($_.ToString())
      $writer.Flush()
    }
    $exitCode = $LASTEXITCODE
    $writer.WriteLine("{0:o} Convex backend exited with code {1}; restarting in 5 seconds." -f [DateTimeOffset]::Now, $exitCode)
    $writer.Flush()
  } catch {
    $writer.WriteLine("{0:o} Convex backend supervisor error: {1}" -f [DateTimeOffset]::Now, $_.Exception.Message)
    $writer.Flush()
  } finally {
    $writer.Dispose()
  }
  Start-Sleep -Seconds 5
}
