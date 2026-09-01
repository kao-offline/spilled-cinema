$ErrorActionPreference = "Stop"

function Invoke-FeedProbe([string]$moduleId, [string]$feedId) {
  $body = @{
    moduleId = $moduleId
    feedId = $feedId
    limit = 4
    fresh = $true
    repositoryUrls = @()
  } | ConvertTo-Json
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $response = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8787/api/provider-feed" -ContentType "application/json" -Body $body -TimeoutSec 90
  $watch.Stop()
  [pscustomobject]@{
    ModuleId = $moduleId
    FeedId = $feedId
    Items = @($response.items).Count
    HasCursor = [bool]$response.nextCursor
    DurationMs = $watch.ElapsedMilliseconds
  }
}

$statuses = for ($attempt = 0; $attempt -lt 5; $attempt++) {
  Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/status" -TimeoutSec 5
}
$feeds = @(
  Invoke-FeedProbe "bombuj" "latest-movies"
  Invoke-FeedProbe "svetserialu" "new-episodes"
)

[pscustomobject]@{
  HealthyStatuses = @($statuses | Where-Object { $_.status -eq "ok" }).Count
  NodeId = $statuses[-1].node.nodeId
  NetworkName = $statuses[-1].node.networkName
  SetupRequired = $statuses[-1].auth.setupRequired
  RuntimeTask = [string](Get-ScheduledTask -TaskName "Spilled Server Runtime" -TaskPath "\").State
  Feeds = $feeds
} | ConvertTo-Json -Depth 4
