param(
  [ValidateSet("Auto", "Cpu", "Nvidia")]
  [string]$Mode = "Auto",
  [switch]$AcceptDownload,
  [switch]$PlanOnly
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
chcp 65001 | Out-Null

$projectDir = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $projectDir "backend"
$venvDir = Join-Path $backendDir ".venv"
$venvPythonPath = Join-Path $venvDir "Scripts\python.exe"
$baseRequirementsPath = Join-Path $backendDir "requirements.txt"
$senseVoiceRequirementsPath = Join-Path $backendDir "requirements-sensevoice-windows.txt"
$prefetchScriptPath = Join-Path $PSScriptRoot "prefetch-asr-models.py"
$cudaInstallerPath = Join-Path $PSScriptRoot "install-sensevoice-cuda.ps1"

function Test-NvidiaGpu {
  try {
    $adapters = @(Get-CimInstance Win32_VideoController -ErrorAction Stop)
    return $null -ne ($adapters | Where-Object { $_.Name -match "NVIDIA" } | Select-Object -First 1)
  } catch {
    Write-Warning "GPU detection failed. Using CPU mode; pass -Mode Nvidia to override."
    return $false
  }
}

function Resolve-InstallMode {
  param([string]$RequestedMode)

  if ($RequestedMode -eq "Cpu") { return "Cpu" }
  if ($RequestedMode -eq "Nvidia") { return "Nvidia" }
  if (Test-NvidiaGpu) { return "Nvidia" }
  return "Cpu"
}

function Invoke-CheckedCommand {
  param(
    [string]$Description,
    [scriptblock]$Command
  )

  Write-Host "[Setup] $Description"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

foreach ($requiredPath in @(
  $baseRequirementsPath,
  $senseVoiceRequirementsPath,
  $prefetchScriptPath,
  $cudaInstallerPath
)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required project file is missing: $requiredPath"
  }
}

$resolvedMode = Resolve-InstallMode -RequestedMode $Mode
$modeLabel = if ($resolvedMode -eq "Nvidia") { "Windows NVIDIA (CUDA)" } else { "CPU" }
$downloadEstimate = if ($resolvedMode -eq "Nvidia") { "roughly 3-6 GB" } else { "roughly 1.5-3.5 GB" }
$diskEstimate = if ($resolvedMode -eq "Nvidia") { "reserve 8-12 GB" } else { "reserve 4-7 GB" }

Write-Host ""
Write-Host "=========================================="
Write-Host "  Zhilu: prepare the complete local ASR environment"
Write-Host "=========================================="
Write-Host "Mode: $modeLabel"
Write-Host "Estimated download: $downloadEstimate (planning range, not a measured total)"
Write-Host "Disk space: $diskEstimate"
Write-Host "Models: SenseVoiceSmall about 0.94 GB plus a small FSMN-VAD model"
Write-Host "These ranges include backend dependencies and models; versions and caches affect totals."
Write-Host "Scope: project backend/.venv and user model caches only."
Write-Host "The script does not change the system PATH, GPU driver, or registry."
Write-Host ""

if ($PlanOnly) {
  Write-Host "[Plan] No dependencies or models were downloaded."
  exit 0
}

if (-not $AcceptDownload) {
  $answer = Read-Host "Prepare the complete environment now? Enter Y to continue"
  if ($answer.Trim().ToUpperInvariant() -ne "Y") {
    Write-Host "Cancelled before installation."
    exit 0
  }
}

if (-not (Test-Path -LiteralPath $venvPythonPath -PathType Leaf)) {
  $systemPython = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($null -eq $systemPython) {
    $systemPython = Get-Command python -ErrorAction SilentlyContinue
  }
  if ($null -eq $systemPython) {
    throw "Python was not found. Install Python 3.10 or newer and reopen the terminal."
  }
  Invoke-CheckedCommand -Description "Creating the project Python virtual environment" -Command {
    & $systemPython.Source -m venv $venvDir
  }
}

Invoke-CheckedCommand -Description "Installing base backend dependencies" -Command {
  & $venvPythonPath -m pip install -r $baseRequirementsPath
}

if ($resolvedMode -eq "Nvidia") {
  Invoke-CheckedCommand -Description "Installing CUDA PyTorch and SenseVoice dependencies" -Command {
    & $cudaInstallerPath
  }
} else {
  Invoke-CheckedCommand -Description "Installing SenseVoice CPU dependencies" -Command {
    & $venvPythonPath -m pip install -r $senseVoiceRequirementsPath
  }
}

Invoke-CheckedCommand -Description "Prefetching SenseVoiceSmall and FSMN-VAD" -Command {
  & $venvPythonPath $prefetchScriptPath
}

Write-Host ""
Write-Host "The complete local ASR environment is ready. You can now run the launcher." -ForegroundColor Green
