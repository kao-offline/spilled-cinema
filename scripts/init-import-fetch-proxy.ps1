param(
  [string]$WorkerName = "spilled-import-fetch-proxy",
  [string]$TargetUrl = "https://svetserialu.to/serial/chernobyl"
)

$ErrorActionPreference = "Stop"

if (-not $env:CLOUDFLARE_API_TOKEN) {
  throw "Set CLOUDFLARE_API_TOKEN before running this script. Wrangler cannot deploy workers without it in this environment."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$workerDir = Join-Path $repoRoot "apps/dashboard/proxy/cloudflare-worker-static"
$wranglerToml = Join-Path $workerDir "wrangler.toml"
$envFile = Join-Path $repoRoot ".env.local"

$proxyKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).TrimEnd("=")

Push-Location $repoRoot
try {
  $deployOutput = npx wrangler deploy --config $wranglerToml --name $WorkerName 2>&1
  $deployOutput | Write-Output
} finally {
  Pop-Location
}

Push-Location $workerDir
try {
  $proxyKey | npx wrangler secret put PROXY_KEY --config $wranglerToml --name $WorkerName
} finally {
  Pop-Location
}

$workerUrl = ($deployOutput | Select-String -Pattern 'https://[^\s]+\.workers\.dev' -AllMatches |
  ForEach-Object { $_.Matches.Value } |
  Select-Object -First 1)
if (-not $workerUrl) {
  throw "Worker deployed, but Wrangler did not print a workers.dev URL. Add IMPORT_FETCH_PROXY_TEMPLATE manually using the deployed Worker URL."
}
$template = "$workerUrl/?key=$proxyKey&url={url}"
$encodedTarget = [Uri]::EscapeDataString($TargetUrl)
$testUrl = $template.Replace("{url}", $encodedTarget)

$response = Invoke-WebRequest -Uri $testUrl -UseBasicParsing -MaximumRedirection 5
if ([int]$response.StatusCode -ne 200 -or $response.Content.Length -lt 1000) {
  throw "Proxy deployed but test failed. Status=$($response.StatusCode), length=$($response.Content.Length)"
}

$existing = if (Test-Path $envFile) { Get-Content $envFile } else { @() }
$next = @($existing | Where-Object { $_ -notmatch '^\s*IMPORT_FETCH_PROXY_TEMPLATE\s*=' })
$next += "IMPORT_FETCH_PROXY_TEMPLATE=$template"
Set-Content -Path $envFile -Value $next

Write-Output "Proxy is functional."
Write-Output "Wrote IMPORT_FETCH_PROXY_TEMPLATE to $envFile"
Write-Output "Restart the dashboard/server process so it reads the new env value."
