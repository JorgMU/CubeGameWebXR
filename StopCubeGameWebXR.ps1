$ErrorActionPreference = 'Stop'

$stateDir = Join-Path $env:LOCALAPPDATA 'cube-game-webxr'
$stateFile = Join-Path $stateDir 'processes.json'

if (-not (Test-Path $stateFile)) {
    Write-Host "No saved process state found at $stateFile" -ForegroundColor Yellow
    Write-Host "If needed, find the server and tunnel with Get-Process py,cloudflared, then stop each by ID: Stop-Process -Id <PID>" -ForegroundColor Yellow
    return
}

try {
    $state = Get-Content -Path $stateFile -Raw | ConvertFrom-Json
}
catch {
    throw "Could not parse process state file: $stateFile"
}

$stoppedAny = $false

$targets = @(
    @{ Name = 'Python server'; ProcessId = [int]($state.ServerPid) },
    @{ Name = 'cloudflared tunnel'; ProcessId = [int]($state.TunnelPid) }
)

foreach ($target in $targets) {
    if ($target.ProcessId -le 0) {
        continue
    }

    $proc = Get-Process -Id $target.ProcessId -ErrorAction SilentlyContinue
    if ($proc) {
        Stop-Process -Id $target.ProcessId -Force
        Write-Host "Stopped $($target.Name) (PID $($target.ProcessId))." -ForegroundColor Green
        $stoppedAny = $true
    }
    else {
        Write-Host "$($target.Name) not running (PID $($target.ProcessId))." -ForegroundColor Yellow
    }
}

Remove-Item -Path $stateFile -Force

if (-not $stoppedAny) {
    Write-Host "No running processes were found, but state file was cleaned up." -ForegroundColor Yellow
}
