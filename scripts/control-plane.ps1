param(
  [ValidateSet("help", "init-local", "seed-providers", "print-node-env", "vercel-env", "convex-env")]
  [string]$Action = "help",
  [string]$DashboardUrl = "",
  [string]$ConvexSiteUrl = "",
  [string]$Secret = "",
  [string]$Environment = "production",
  [string]$ProjectName = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RootEnvPath = Join-Path $RepoRoot ".env.local"

function Read-DotEnvFile([string]$Path) {
  $values = @{}
  if (!(Test-Path $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (!$trimmed -or $trimmed.StartsWith("#") -or !$trimmed.Contains("=")) {
      continue
    }
    $key, $value = $trimmed.Split("=", 2)
    $values[$key.Trim()] = $value.Trim().Trim('"').Trim("'")
  }
  return $values
}

function Write-DotEnvValue([string]$Path, [string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path $Path) {
    $lines = @(Get-Content -LiteralPath $Path)
  }

  $pattern = "^\s*$([regex]::Escape($Key))="
  $updated = $false
  $next = foreach ($line in $lines) {
    if ($line -match $pattern) {
      $updated = $true
      "$Key=$Value"
    } else {
      $line
    }
  }

  if (!$updated) {
    $next += "$Key=$Value"
  }

  Set-Content -LiteralPath $Path -Value $next -Encoding UTF8
}

function New-ControlPlaneSecret {
  $bytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).Replace("+", "-").Replace("/", "_").TrimEnd("=")
}

function Get-NpxCommand {
  if ($IsWindows -or $env:OS -eq "Windows_NT") {
    return "npx.cmd"
  }
  return "npx"
}

function Add-VercelEnvValue([string]$Name, [string]$Value, [string]$TargetEnvironment) {
  $npx = Get-NpxCommand
  $Value | & $npx vercel env add $Name $TargetEnvironment
}

function Get-LinkedVercelProject {
  $dashboardProjectPath = Join-Path $RepoRoot "apps/dashboard/.vercel/project.json"
  if (Test-Path $dashboardProjectPath) {
    $project = Get-Content -Raw -LiteralPath $dashboardProjectPath | ConvertFrom-Json
    return @{
      projectName = $project.projectName
      projectId = $project.projectId
      orgId = $project.orgId
      source = $dashboardProjectPath
    }
  }

  $repoPath = Join-Path $RepoRoot ".vercel/repo.json"
  if (Test-Path $repoPath) {
    $repo = Get-Content -Raw -LiteralPath $repoPath | ConvertFrom-Json
    $dashboardProject = @($repo.projects) | Where-Object { $_.directory -eq "apps/dashboard" } | Select-Object -First 1
    if ($dashboardProject) {
      return @{
        projectName = $dashboardProject.name
        projectId = $dashboardProject.id
        orgId = $dashboardProject.orgId
        source = $repoPath
      }
    }
  }

  return $null
}

function Assert-LinkedVercelProject {
  param([string]$ExpectedProjectName)

  $linked = Get-LinkedVercelProject
  if (!$linked) {
    throw "apps/dashboard is not linked to a Vercel project. Run: cd apps/dashboard; npx vercel link --project spilled-cinema"
  }

  Write-Host "Linked Vercel project: $($linked.projectName) ($($linked.projectId)) from $($linked.source)"
  if ($ExpectedProjectName -and $linked.projectName -ne $ExpectedProjectName) {
    throw "Wrong Vercel project linked. Expected '$ExpectedProjectName', got '$($linked.projectName)'. Run: cd apps/dashboard; npx vercel link --project $ExpectedProjectName"
  }
}

function Get-ControlPlaneConfig {
  $rootEnv = Read-DotEnvFile $RootEnvPath
  $dashboardEnv = Read-DotEnvFile (Join-Path $RepoRoot "apps/dashboard/.env.local")

  $siteUrl = if ($ConvexSiteUrl) { $ConvexSiteUrl } elseif ($env:CONVEX_SITE_URL) { $env:CONVEX_SITE_URL } elseif ($rootEnv.CONVEX_SITE_URL) { $rootEnv.CONVEX_SITE_URL } else { $dashboardEnv.CONVEX_SITE_URL }
  $dashboard = if ($DashboardUrl) { $DashboardUrl } elseif ($env:SPILLED_DASHBOARD_URL) { $env:SPILLED_DASHBOARD_URL } else { $rootEnv.SPILLED_DASHBOARD_URL }
  $secretValue = if ($Secret) { $Secret } elseif ($env:SPILLED_CONTROL_PLANE_SECRET) { $env:SPILLED_CONTROL_PLANE_SECRET } else { $rootEnv.SPILLED_CONTROL_PLANE_SECRET }
  $planeUrl = if ($dashboard) { "$($dashboard.TrimEnd('/'))/api/server" } elseif ($siteUrl) { "$($siteUrl.TrimEnd('/'))/server" } else { "" }

  return @{
    ConvexSiteUrl = $siteUrl
    DashboardUrl = $dashboard
    Secret = $secretValue
    ControlPlaneUrl = $planeUrl
  }
}

function Show-Help {
  @"
SpilledCinema control-plane helper

Commands:
  npm run control-plane -- help
  npm run control-plane -- init-local -DashboardUrl https://your-app.vercel.app -ConvexSiteUrl https://your.convex.site
  npm run control-plane -- seed-providers
  npm run control-plane -- print-node-env -DashboardUrl https://your-app.vercel.app
  npm run control-plane -- vercel-env -DashboardUrl https://your-app.vercel.app -ConvexSiteUrl https://your.convex.site
  npm run control-plane -- vercel-env -ProjectName spilled-cinema -DashboardUrl https://your-app.vercel.app -ConvexSiteUrl https://your.convex.site
  npm run control-plane -- convex-env

What it manages:
  CONVEX_SITE_URL
  SPILLED_DASHBOARD_URL
  SPILLED_CONTROL_PLANE_URL
  SPILLED_CONTROL_PLANE_SECRET

Secrets belong in Vercel Environment Variables for the dashboard project and in .env.local for local/node runs.
"@ | Write-Host
}

switch ($Action) {
  "help" {
    Show-Help
  }
  "init-local" {
    $config = Get-ControlPlaneConfig
    if (!$config.Secret) {
      $config.Secret = New-ControlPlaneSecret
    }
    if (!$config.ControlPlaneUrl) {
      throw "Provide -DashboardUrl or -ConvexSiteUrl so the control-plane URL can be inferred."
    }

    Write-DotEnvValue $RootEnvPath "SPILLED_CONTROL_PLANE_SECRET" $config.Secret
    Write-DotEnvValue $RootEnvPath "SPILLED_CONTROL_PLANE_URL" $config.ControlPlaneUrl
    if ($config.DashboardUrl) {
      Write-DotEnvValue $RootEnvPath "SPILLED_DASHBOARD_URL" $config.DashboardUrl
    }
    if ($config.ConvexSiteUrl) {
      Write-DotEnvValue $RootEnvPath "CONVEX_SITE_URL" $config.ConvexSiteUrl
    }

    Write-Host "Wrote local control-plane values to $RootEnvPath"
    Write-Host "SPILLED_CONTROL_PLANE_URL=$($config.ControlPlaneUrl)"
  }
  "seed-providers" {
    $config = Get-ControlPlaneConfig
    if (!$config.Secret) {
      throw "Missing SPILLED_CONTROL_PLANE_SECRET. Run init-local or pass -Secret."
    }
    if (!$config.ControlPlaneUrl) {
      throw "Missing control-plane URL. Pass -DashboardUrl or -ConvexSiteUrl."
    }

    $url = "$($config.ControlPlaneUrl.TrimEnd('/'))/provider-modules/seed"
    $headers = @{ "x-spilled-control-plane-secret" = $config.Secret }
    $result = Invoke-RestMethod -Method Post -Uri $url -Headers $headers
    $result | ConvertTo-Json -Depth 8
  }
  "print-node-env" {
    $config = Get-ControlPlaneConfig
    if (!$config.ControlPlaneUrl) {
      throw "Pass -DashboardUrl for Vercel-controlled nodes, or -ConvexSiteUrl for direct Convex control."
    }

    @"
Set these on each node:

SPILLED_CONTROL_PLANE_URL=$($config.ControlPlaneUrl)
SPILLED_NODE_ENDPOINT_URL=https://YOUR_PUBLIC_NODE_HOST
SPILLED_VAULT_PATH=/absolute/path/to/downloads
CORS_ORIGIN=$($config.DashboardUrl)

Then run:
  npm run start:server
"@ | Write-Host
  }
  "vercel-env" {
    Assert-LinkedVercelProject $ProjectName
    $config = Get-ControlPlaneConfig
    if (!$config.ConvexSiteUrl) {
      throw "Pass -ConvexSiteUrl. The Vercel dashboard API proxy needs CONVEX_SITE_URL."
    }
    if (!$config.Secret) {
      $config.Secret = New-ControlPlaneSecret
      Write-Host "Generated SPILLED_CONTROL_PLANE_SECRET."
    }

    Write-Host "Adding Vercel env vars for $Environment. Run this from the linked Vercel dashboard project."
    Push-Location (Join-Path $RepoRoot "apps/dashboard")
    try {
      Add-VercelEnvValue "CONVEX_SITE_URL" $config.ConvexSiteUrl $Environment
      Add-VercelEnvValue "SPILLED_CONTROL_PLANE_SECRET" $config.Secret $Environment
      if ($config.DashboardUrl) {
        Add-VercelEnvValue "SPILLED_DASHBOARD_URL" $config.DashboardUrl $Environment
      }
    } finally {
      Pop-Location
    }
    Write-Host "Done. Redeploy the Vercel site after changing env vars."
  }
  "convex-env" {
    $config = Get-ControlPlaneConfig
    if (!$config.Secret) {
      $config.Secret = New-ControlPlaneSecret
      Write-DotEnvValue $RootEnvPath "SPILLED_CONTROL_PLANE_SECRET" $config.Secret
      Write-Host "Generated and saved SPILLED_CONTROL_PLANE_SECRET to $RootEnvPath."
    }

    npx convex env set SPILLED_CONTROL_PLANE_SECRET $config.Secret --prod
    Write-Host "Set SPILLED_CONTROL_PLANE_SECRET on the Convex production deployment."
  }
}
