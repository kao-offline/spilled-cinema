param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "status", "logs", "stop")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ComposeFile = Join-Path $ProjectRoot "docker-compose.verifier.yml"
$LocalEnvFile = Join-Path $ProjectRoot ".env.local"

function Read-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if (!(Test-Path -LiteralPath $LocalEnvFile)) {
    throw "Missing $LocalEnvFile."
  }

  $prefix = "$Name="
  $line = Get-Content -LiteralPath $LocalEnvFile |
    Where-Object { $_.StartsWith($prefix, [System.StringComparison]::Ordinal) } |
    Select-Object -First 1

  if (!$line) {
    throw "Missing $Name in $LocalEnvFile."
  }

  return $line.Substring($prefix.Length).Trim().Trim('"').Trim("'")
}

function Wait-ForDocker {
  docker info --format "{{.ServerVersion}}" 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    return
  }

  Write-Host "Starting Docker Desktop..."
  docker desktop start
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop could not be started."
  }

  for ($attempt = 1; $attempt -le 30; $attempt++) {
    docker info --format "{{.ServerVersion}}" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "Docker Desktop did not become ready within 60 seconds."
}

$env:SPILLED_CONTROL_PLANE_URL = "https://cheerful-lynx-4.convex.site/server"
$env:SPILLED_GATEWAY_URL = "https://spilled-node-gateway.4thsj85ywn.workers.dev"
$env:SPILLED_CONTROL_PLANE_SECRET = Read-DotEnvValue "SPILLED_CONTROL_PLANE_SECRET"

Push-Location $ProjectRoot
try {
  switch ($Action) {
    "start" {
      Wait-ForDocker
      docker compose -f $ComposeFile up -d --build
      if ($LASTEXITCODE -ne 0) {
        throw "Verifier failed to start."
      }
      docker compose -f $ComposeFile ps
    }
    "status" {
      Wait-ForDocker
      docker compose -f $ComposeFile ps
    }
    "logs" {
      Wait-ForDocker
      docker compose -f $ComposeFile logs --tail 100 -f
    }
    "stop" {
      Wait-ForDocker
      docker compose -f $ComposeFile down
    }
  }
} finally {
  Pop-Location
}
