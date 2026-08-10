# test-verifier.ps1 — Tests verifier gateway probing
# Usage: .\scripts\test-verifier.ps1 [-NodeId node_xxx] [-GatewayUrl wss://gateway.spilled.overload.studio]

param(
  [string]$NodeId,
  [string]$GatewayUrl = "wss://gateway.spilled.overload.studio",
  [string]$ControlPlaneUrl = "https://cheerful-lynx-4.convex.cloud"
)

$ErrorActionPreference = "Continue"

Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Verifier Connection Test" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan

# ── 1. Check if verifier binary exists ──
Write-Host "`n>>> Checking verifier binary" -ForegroundColor Cyan
$verifierPath = "apps\verifier-windows\release\win-unpacked\Spilled Verifier.exe"
if (Test-Path $verifierPath) {
  Write-Host "    PASS: Verifier binary found at $verifierPath" -ForegroundColor Green
} else {
  Write-Host "    INFO: Verifier binary not found (expected if not built locally)" -ForegroundColor Yellow
}

# ── 2. Check verifier status file ──
Write-Host "`n>>> Checking verifier status file" -ForegroundColor Cyan
$statusFile = "$env:APPDATA\spilled-verifier\status.json"
if (Test-Path $statusFile) {
  $status = Get-Content $statusFile -Raw | ConvertFrom-Json
  Write-Host "    Last run: $($status.lastRunAt)" -ForegroundColor Gray
  Write-Host "    Nodes: $($status.nodes)  Verified: $($status.verified)  Degraded: $($status.degraded)" -ForegroundColor Gray
  if ($status.errors) {
    Write-Host "    Errors:" -ForegroundColor Red
    $status.errors | ForEach-Object { Write-Host "      - $_" -ForegroundColor Red }
  }
  if ($status.degraded -gt 0 -or $status.errors.Count -gt 0) {
    Write-Host "    FAIL: Verifier has degraded nodes or errors" -ForegroundColor Red
  } else {
    Write-Host "    PASS: All nodes verified" -ForegroundColor Green
  }
} else {
  Write-Host "    INFO: No verifier status file found at $statusFile" -ForegroundColor Yellow
}

# ── 3. Test gateway WebSocket connectivity ──
Write-Host "`n>>> Testing gateway WebSocket endpoint" -ForegroundColor Cyan
$wsHost = ($GatewayUrl -replace "^wss?://", "" -replace "/$", "")
try {
  # Use a simple TCP test to check if the gateway is reachable
  $tcp = New-Object System.Net.Sockets.TcpClient
  $connect = $tcp.ConnectAsync($wsHost.Split(":")[0], 443)
  $connect.Wait(5000) | Out-Null
  if ($tcp.Connected) {
    Write-Host "    PASS: Gateway port 443 is reachable" -ForegroundColor Green
  } else {
    Write-Host "    FAIL: Cannot reach gateway on port 443" -ForegroundColor Red
  }
  $tcp.Close()
} catch {
  Write-Host "    FAIL: Gateway TCP check failed: $($_.Exception.Message)" -ForegroundColor Red
}

# ── 4. Check server logs for gateway link ──
Write-Host "`n>>> Checking for gateway link logs" -ForegroundColor Cyan
Write-Host "    Look for these messages in the server console:" -ForegroundColor Gray
Write-Host "      [managed-gateway] connecting to gateway as node_..." -ForegroundColor Gray
Write-Host "      [managed-gateway] encrypted node link connected" -ForegroundColor Gray
Write-Host "      [managed-gateway] node application accepted; verification is pending" -ForegroundColor Gray
Write-Host "    If you see:" -ForegroundColor Gray
Write-Host "      [managed-gateway] unavailable; local operation continues → apply() failed" -ForegroundColor Yellow
Write-Host "      [managed-gateway] node link closed (4xxx: ...) → gateway rejected the connection" -ForegroundColor Yellow

# ── 5. Manual probe test ──
if ($NodeId) {
  Write-Host "`n>>> Manual gateway probe for $NodeId" -ForegroundColor Cyan
  $ticketUrl = "$ControlPlaneUrl/api/v2/tickets"
  Write-Host "    To manually test: run the verifier with SPILLED_VERIFIER_ONCE=1" -ForegroundColor Gray
  Write-Host "    Or check the verifier tray app logs for probe results" -ForegroundColor Gray
} else {
  Write-Host "`n>>> Skipping manual probe (no NodeId provided)" -ForegroundColor Yellow
  Write-Host "    Run with: .\scripts\test-verifier.ps1 -NodeId node_xxxxx" -ForegroundColor Gray
}

Write-Host "`n═══════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Done" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════" -ForegroundColor Cyan
