# test-connection.ps1 — Tests server-gateway-verifier connection
# Usage: .\scripts\test-connection.ps1 [-ServerPort 8787] [-GatewayUrl wss://gateway.spilled.overload.studio]

param(
  [int]$ServerPort = 8787,
  [string]$GatewayUrl = "wss://gateway.spilled.overload.studio",
  [string]$ControlPlaneUrl = "https://cheerful-lynx-4.convex.cloud"
)

$ErrorActionPreference = "Continue"
$serverBase = "http://127.0.0.1:$ServerPort"
$results = @()

function Test-Step {
  param([string]$Name, [scriptblock]$Test)
  Write-Host "`n>>> $Name" -ForegroundColor Cyan
  try {
    $result = & $Test
    if ($result.Success) {
      Write-Host "    PASS: $($result.Message)" -ForegroundColor Green
      $script:results += [PSCustomObject]@{ Step = $Name; Status = "PASS"; Message = $result.Message }
    } else {
      Write-Host "    FAIL: $($result.Message)" -ForegroundColor Red
      $script:results += [PSCustomObject]@{ Step = $Name; Status = "FAIL"; Message = $result.Message }
    }
  } catch {
    Write-Host "    ERROR: $($_.Exception.Message)" -ForegroundColor Red
    $script:results += [PSCustomObject]@{ Step = $Name; Status = "ERROR"; Message = $_.Exception.Message }
  }
}

# ── 1. Server Health ──
Test-Step "Server health check" {
  $resp = Invoke-WebRequest -Uri "$serverBase/v2/health/ready" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
  if ($resp.StatusCode -eq 200) {
    return @{ Success = $true; Message = "Server is ready on port $ServerPort" }
  }
  return @{ Success = $false; Message = "Server returned $($resp.StatusCode)" }
}

# ── 2. CORS — approved origin ──
Test-Step "CORS: approved origin allowed" {
  $resp = Invoke-WebRequest -Uri "$serverBase/v2/protocol" -Headers @{ Origin = "http://127.0.0.1:5173" } -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
  $corsOrigin = $resp.Headers["Access-Control-Allow-Origin"]
  if ($resp.StatusCode -eq 200 -and $corsOrigin -eq "http://127.0.0.1:5173") {
    return @{ Success = $true; Message = "Approved origin passes CORS" }
  }
  return @{ Success = $false; Message = "CORS check failed: status=$($resp.StatusCode) acao=$corsOrigin" }
}

# ── 3. CORS — rejected origin ──
Test-Step "CORS: unapproved origin blocked" {
  try {
    $resp = Invoke-WebRequest -Uri "$serverBase/v2/protocol" -Headers @{ Origin = "https://malicious.example" } -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    return @{ Success = $false; Message = "Unapproved origin was NOT blocked (got $($resp.StatusCode))" }
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 403) {
      return @{ Success = $true; Message = "Unapproved origin correctly returns 403" }
    }
    return @{ Success = $false; Message = "Unexpected error: $($_.Exception.Message)" }
  }
}

# ── 4. CORS — browser-file exempt ──
Test-Step "CORS: /api/download-full/browser-file exempt from CORS" {
  try {
    $resp = Invoke-WebRequest -Uri "$serverBase/api/download-full/browser-file?url=https://example.com/test.vtt&playback=1" `
      -Headers @{ Origin = "https://vidking.net" } -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    # Any response that isn't 403 means CORS exemption works
    return @{ Success = $true; Message = "Browser-file endpoint returned $($resp.StatusCode) (not 403 = CORS exempt)" }
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 403) {
      return @{ Success = $false; Message = "Browser-file endpoint still returns 403 - CORS exemption NOT working" }
    }
    # Other errors (404, 502, etc.) are fine — means CORS was bypassed
    return @{ Success = $true; Message = "Browser-file endpoint returned $code (not 403 = CORS exempt)" }
  }
}

# ── 5. Node identity ──
Test-Step "Node identity endpoint" {
  try {
    $resp = Invoke-WebRequest -Uri "$serverBase/api/node/identity" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    $json = $resp.Content | ConvertFrom-Json
    if ($json.nodeId -and $json.nodeId.StartsWith("node_")) {
      return @{ Success = $true; Message = "Node ID: $($json.nodeId)" }
    }
    return @{ Success = $false; Message = "Invalid node identity: $($resp.Content)" }
  } catch {
    return @{ Success = $false; Message = "Node identity endpoint failed: $($_.Exception.Message)" }
  }
}

# ── 6. Status endpoint ──
Test-Step "Status endpoint returns node info" {
  try {
    $resp = Invoke-WebRequest -Uri "$serverBase/api/status" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    $json = $resp.Content | ConvertFrom-Json
    $props = ($json.PSObject.Properties.Name) -join ", "
    return @{ Success = $true; Message = "Status fields: $props" }
  } catch {
    return @{ Success = $false; Message = "Status endpoint failed: $($_.Exception.Message)" }
  }
}

# ── 7. Gateway connectivity (if gateway URL provided) ──
Test-Step "Gateway health check" {
  try {
    $wsUrl = $GatewayUrl -replace "^wss?", "https" -replace "/$", ""
    $resp = Invoke-WebRequest -Uri "$wsUrl/v2/health/live" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    if ($resp.StatusCode -eq 200) {
      return @{ Success = $true; Message = "Gateway is reachable" }
    }
    return @{ Success = $false; Message = "Gateway returned $($resp.StatusCode)" }
  } catch {
    return @{ Success = $false; Message = "Gateway unreachable: $($_.Exception.Message)" }
  }
}

# ── 8. Control plane connectivity ──
Test-Step "Control plane health" {
  try {
    $resp = Invoke-WebRequest -Uri "$ControlPlaneUrl/api/v2/health" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    return @{ Success = $true; Message = "Control plane is reachable" }
  } catch {
    # Convex might not have a /api/v2/health endpoint, try root
    try {
      $resp = Invoke-WebRequest -Uri "$ControlPlaneUrl" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
      return @{ Success = $true; Message = "Control plane is reachable (root)" }
    } catch {
      return @{ Success = $false; Message = "Control plane unreachable: $($_.Exception.Message)" }
    }
  }
}

# ── Summary ──
Write-Host "`n═══════════════════════════════════════" -ForegroundColor Yellow
Write-Host "  TEST SUMMARY" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════" -ForegroundColor Yellow
$pass = ($results | Where-Object { $_.Status -eq "PASS" }).Count
$fail = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
$err = ($results | Where-Object { $_.Status -eq "ERROR" }).Count
$results | Format-Table -AutoSize
Write-Host "Pass: $pass  Fail: $fail  Error: $err" -ForegroundColor $(if ($fail -eq 0 -and $err -eq 0) { "Green" } else { "Red" })
