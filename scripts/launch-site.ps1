$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $projectDir "backend"
$frontendDir = Join-Path $projectDir "frontend"
$logPath = Join-Path $projectDir "launcher.log"
$backendUrl = "http://127.0.0.1:8000/api/health"
$frontendUrl = "http://127.0.0.1:3000"

function Write-LaunchLog {
  param([string]$Message)

  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" | Out-File -FilePath $logPath -Append -Encoding utf8
}

function Wait-ForUrl {
  param(
    [string]$Url,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  return $false
}

function Test-IsProjectProcess {
  param(
    [int]$ProcessId
  )

  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId"
  } catch {
    return $false
  }

  if ($null -eq $process) {
    return $false
  }

  $projectPath = $projectDir.ToLowerInvariant()
  $commandLine = [string]$process.CommandLine
  $executablePath = [string]$process.ExecutablePath
  if (
    $commandLine.ToLowerInvariant().Contains($projectPath) -or
    $executablePath.ToLowerInvariant().Contains($projectPath)
  ) {
    return $true
  }

  if ($process.ParentProcessId -and $process.ParentProcessId -ne $ProcessId) {
    return Test-IsProjectProcess -ProcessId $process.ParentProcessId
  }

  return $false
}

function Get-ChildProcessIds {
  param(
    [int]$ProcessId
  )

  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId")
  $ids = @()
  foreach ($child in $children) {
    $ids += [int]$child.ProcessId
    $ids += Get-ChildProcessIds -ProcessId ([int]$child.ProcessId)
  }

  return $ids
}

function Get-ProjectAncestorIds {
  param(
    [int]$ProcessId
  )

  $ids = @()
  $currentProcessId = $ProcessId
  while ($true) {
    $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$currentProcessId"
    if ($null -eq $currentProcess -or -not $currentProcess.ParentProcessId) {
      break
    }

    $parentProcessId = [int]$currentProcess.ParentProcessId
    if ($parentProcessId -eq $currentProcessId) {
      break
    }

    if (-not (Test-IsProjectProcess -ProcessId $parentProcessId)) {
      break
    }

    $ids += $parentProcessId
    $currentProcessId = $parentProcessId
  }

  return $ids
}

function Stop-ProjectProcessOnPort {
  param(
    [int]$Port,
    [string]$Name
  )

  $connections = @(
    Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  )

  foreach ($connection in $connections) {
    $processId = [int]$connection.OwningProcess
    if (-not (Test-IsProjectProcess -ProcessId $processId)) {
      throw "$Name port $Port is already used by another process: PID $processId"
    }

    $idsToStop = @($processId)
    $idsToStop += Get-ChildProcessIds -ProcessId $processId
    $idsToStop += Get-ProjectAncestorIds -ProcessId $processId
    $idsToStop = $idsToStop | Select-Object -Unique | Sort-Object -Descending

    Write-Host "[$Name] Stopping previous project process on port $Port..."
    Write-LaunchLog "Stopping previous $Name process on port $Port"
    foreach ($idToStop in $idsToStop) {
      Stop-Process -Id $idToStop -Force -ErrorAction SilentlyContinue
    }
  }
}

Set-Content -Path $logPath -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Launcher started" -Encoding utf8

Write-Host ""
Write-Host "=========================================="
Write-Host "  AI Video Insight Workspace Launcher"
Write-Host "=========================================="
Write-Host ""

if (-not (Test-Path (Join-Path $backendDir "requirements.txt"))) {
  throw "Backend directory is invalid: $backendDir"
}

if (-not (Test-Path (Join-Path $frontendDir "package.json"))) {
  throw "Frontend directory is invalid: $frontendDir"
}

$backendEnvPath = Join-Path $backendDir ".env"
if (-not (Test-Path -LiteralPath $backendEnvPath)) {
  Write-Host "[Setup] Configure your own AI API key (optional)..."
  Write-LaunchLog "Opening first-run AI configuration"
  & (Join-Path $PSScriptRoot "configure-ai.ps1") -FirstRunOnly
}

Stop-ProjectProcessOnPort -Port 8000 -Name "Backend"
Stop-ProjectProcessOnPort -Port 3000 -Name "Frontend"
Start-Sleep -Seconds 1

$pythonPath = Join-Path $backendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonPath)) {
  Write-Host "[Backend] Creating Python virtual environment..."
  Write-LaunchLog "Creating Python virtual environment"
  Push-Location $backendDir
  try {
    python -m venv .venv
  } finally {
    Pop-Location
  }
}

Write-Host "[Backend] Checking Python dependencies..."
Write-LaunchLog "Checking Python dependencies"
Push-Location $backendDir
try {
  & $pythonPath -m pip install -r requirements.txt
} finally {
  Pop-Location
}

if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
  Write-Host "[Frontend] Installing npm dependencies..."
  Write-LaunchLog "Installing npm dependencies"
  Push-Location $frontendDir
  try {
    npm install
  } finally {
    Pop-Location
  }
}

Write-Host "[Backend] Starting FastAPI: http://127.0.0.1:8000"
Write-LaunchLog "Starting backend"
$backendCommand = "cd /d `"$backendDir`" && `".venv\Scripts\python.exe`" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $backendCommand

Write-Host "[Backend] Waiting for FastAPI..."
if (Wait-ForUrl -Url $backendUrl -TimeoutSeconds 45) {
  Write-LaunchLog "Backend is ready"
} else {
  Write-Host "[Warning] Backend was not ready after 45 seconds. The frontend will still start."
  Write-Host "[Hint] Check the backend command window for errors."
  Write-LaunchLog "Backend wait timed out"
}

Write-Host "[Frontend] Starting Next.js: $frontendUrl"
Write-LaunchLog "Starting frontend"
$frontendCommand = "cd /d `"$frontendDir`" && npm run dev -- --hostname 127.0.0.1 --port 3000"
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $frontendCommand

Write-Host ""
Write-Host "[Frontend] Waiting for Next.js. First start can take more than 20 seconds..."
if (-not (Wait-ForUrl -Url $frontendUrl -TimeoutSeconds 90)) {
  Write-LaunchLog "Frontend wait timed out"
  throw "Frontend was not ready after 90 seconds. Check the frontend command window for errors."
}

Write-LaunchLog "Frontend is ready"
Write-Host "Opening browser..."
Start-Process $frontendUrl
Write-LaunchLog "Browser opened"

Write-Host ""
Write-Host "Startup launched. Keep the backend and frontend command windows open."
