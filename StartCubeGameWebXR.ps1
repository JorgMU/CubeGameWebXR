# Serves the app/ subfolder only — the same pattern as the EarthAndMoon
# pair, which served EarthAndMoonWebXR beside the scripts. Run from the
# repo root (CubeGameWebXR). Only files in app/ are reachable via the
# web server; README, scripts, and .gitignore stay out of the web root.
param(
    [int]$Port = 8001
)

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $scriptRoot 'app'

if (-not (Test-Path -Path $appDir -PathType Container)) {
    throw "App folder not found: $appDir"
}

$pythonCmd = Get-Command py -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    throw "Python launcher 'py' was not found in PATH. Install Python 3.12 and try again."
}

$cloudflaredCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflaredCmd) {
    throw "cloudflared was not found in PATH. Install it with: winget install Cloudflare.cloudflared"
}

$stateDir = Join-Path $env:LOCALAPPDATA 'cube-game-webxr'
$stateFile = Join-Path $stateDir 'processes.json'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

if (Test-Path $stateFile) {
    try {
        $existing = Get-Content $stateFile -Raw | ConvertFrom-Json
        $running = @()

        foreach ($processId in @($existing.ServerPid, $existing.TunnelPid)) {
            if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
                $running += $processId
            }
        }

        if ($running.Count -gt 0) {
            Write-Host "CubeGameWebXR services already running. PIDs: $($running -join ', ')" -ForegroundColor Yellow
            Write-Host "Attempting to stop existing services by calling ./StopCubeGameWebXR.ps1 ..." -ForegroundColor Yellow
            & "$scriptRoot\StopCubeGameWebXR.ps1"
            Start-Sleep -Seconds 2
            $stillRunning = @()
            foreach ($processId in @($existing.ServerPid, $existing.TunnelPid)) {
                if ($processId -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
                    $stillRunning += $processId
                }
            }
            if ($stillRunning.Count -gt 0) {
                Write-Host "Some services could not be stopped automatically. Please stop these PIDs manually: $($stillRunning -join ', ')" -ForegroundColor Red
                return
            } else {
                Write-Host "Previous services stopped. Continuing startup..." -ForegroundColor Green
            }
        }
    }
    catch {
        Write-Host "Ignoring unreadable state file: $stateFile" -ForegroundColor Yellow
    }
}

$cloudflaredLogFile = Join-Path $stateDir 'cloudflared.log'
$cloudflaredErrorLogFile = Join-Path $stateDir 'cloudflared.err.log'
if (Test-Path $cloudflaredLogFile) {
    Remove-Item -Path $cloudflaredLogFile -Force
}
if (Test-Path $cloudflaredErrorLogFile) {
    Remove-Item -Path $cloudflaredErrorLogFile -Force
}

$serverArgs = @('-m', 'http.server', $Port, '--bind', '0.0.0.0', '--directory', $appDir)
$server = Start-Process -FilePath 'py' -ArgumentList $serverArgs -WorkingDirectory $appDir -WindowStyle Minimized -PassThru

$tunnelUrl = "http://localhost:$Port"
$tunnelArgs = @('tunnel', '--url', $tunnelUrl)
$tunnel = Start-Process `
    -FilePath 'cloudflared' `
    -ArgumentList $tunnelArgs `
    -WorkingDirectory $appDir `
    -WindowStyle Minimized `
    -RedirectStandardOutput $cloudflaredLogFile `
    -RedirectStandardError $cloudflaredErrorLogFile `
    -PassThru

$publicUrl = $null
$urlPattern = 'https://[a-z0-9-]+\.trycloudflare\.com'
$timeout = [TimeSpan]::FromSeconds(20)
$watch = [Diagnostics.Stopwatch]::StartNew()

while ($watch.Elapsed -lt $timeout -and -not $publicUrl) {
    foreach ($logPath in @($cloudflaredLogFile, $cloudflaredErrorLogFile)) {
        if (Test-Path $logPath) {
            $logText = Get-Content -Path $logPath -Raw -ErrorAction SilentlyContinue
            if ($logText) {
                $match = [regex]::Match($logText, $urlPattern)
                if ($match.Success) {
                    $publicUrl = $match.Value
                    break
                }
            }
        }
    }
    if ($publicUrl) { break }
    Start-Sleep -Milliseconds 400
}

$state = [ordered]@{
    Port = $Port
    AppDir = $appDir
    ServerPid = $server.Id
    TunnelPid = $tunnel.Id
    CloudflaredLogFile = $cloudflaredLogFile
    CloudflaredErrorLogFile = $cloudflaredErrorLogFile
    PublicUrl = $publicUrl
    StartedAtUtc = [DateTime]::UtcNow.ToString('o')
}

$state | ConvertTo-Json | Set-Content -Path $stateFile -Encoding utf8

Write-Host "Started CubeGameWebXR server (PID $($server.Id)) on port $Port." -ForegroundColor Green
Write-Host "Started cloudflared tunnel (PID $($tunnel.Id))." -ForegroundColor Green
if ($publicUrl) {
    try {
        Set-Clipboard -Value $publicUrl
        Write-Host "Tunnel URL has been copied to the clipboard." -ForegroundColor Cyan
    }
    catch {
        Write-Host "Could not copy tunnel URL to clipboard." -ForegroundColor Yellow
    }
    Write-Host $publicUrl -ForegroundColor Cyan
}
else {
    Write-Host "Cloudflare URL was not detected yet. Check logs:" -ForegroundColor Yellow
    Write-Host "  stdout: $cloudflaredLogFile" -ForegroundColor Yellow
    Write-Host "  stderr: $cloudflaredErrorLogFile" -ForegroundColor Yellow
}
Write-Host "Use ./StopCubeGameWebXR.ps1 to stop both processes." -ForegroundColor Cyan
