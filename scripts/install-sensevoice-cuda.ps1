param(
  [string]$TorchIndexUrl = "https://download.pytorch.org/whl/cu128",
  [int]$NetworkTimeoutSeconds = 60,
  [int]$ResumeRetries = 20
)

$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
chcp 65001 | Out-Null

$projectDir = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $projectDir "backend"
$pythonPath = Join-Path $backendDir ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $pythonPath)) {
  throw "Project virtual environment not found. Run the launcher first."
}

Push-Location $backendDir
try {
  Write-Host "Installing torch and torchaudio from the official PyTorch CUDA index..."
  & $pythonPath -m pip install --upgrade --force-reinstall --no-deps torch torchaudio `
    --index-url $TorchIndexUrl `
    --timeout $NetworkTimeoutSeconds `
    --retries 5 `
    --resume-retries $ResumeRetries `
    --progress-bar on
  if ($LASTEXITCODE -ne 0) {
    throw "CUDA-enabled PyTorch installation failed."
  }

  & $pythonPath -m pip install -r requirements-sensevoice-windows.txt
  if ($LASTEXITCODE -ne 0) {
    throw "SenseVoice optional dependency installation failed."
  }

  & $pythonPath -c "import torch; available=torch.cuda.is_available(); print('torch=' + str(torch.__version__)); print('cuda_available=' + str(available)); print('cuda_runtime=' + str(torch.version.cuda)); print('device=' + (torch.cuda.get_device_name(0) if available else 'cpu')); raise SystemExit(0 if available else 'CUDA is unavailable after installation')"
  if ($LASTEXITCODE -ne 0) {
    throw "CUDA runtime verification failed."
  }
} finally {
  Pop-Location
}

Write-Host "Installation complete. Restart the backend before running SenseVoiceSmall."
