$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$problems = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

$gitIgnorePath = Join-Path $projectDir ".gitignore"
$gitIgnoreLines = @(Get-Content -LiteralPath $gitIgnorePath -Encoding UTF8)
foreach ($requiredRule in @(
  ".env",
  "!.env.example",
  "backend/data/*",
  "evaluation/",
  "docs/plans/",
  "docs/handoffs/",
  "*.log"
)) {
  if ($gitIgnoreLines -notcontains $requiredRule) {
    $problems.Add("Required .gitignore rule is missing: $requiredRule")
  }
}

function Convert-ToRelativePath {
  param([string]$Path)
  $rootPath = [IO.Path]::GetFullPath($projectDir).TrimEnd("\") + "\"
  $fullPath = [IO.Path]::GetFullPath($Path)
  if (-not $fullPath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside the project directory: $fullPath"
  }
  return $fullPath.Substring($rootPath.Length).Replace("\", "/")
}

function Test-ProhibitedPath {
  param([string]$RelativePath)
  $isPrivateEnv = $RelativePath -match '(^|/)\.env($|\.(?!example$))'
  return $isPrivateEnv -or
    $RelativePath -match '(^|/)(evaluation/|docs/(plans|handoffs)/|docs/project-context\.md$)' -or
    $RelativePath -match '\.(log|sqlite3?|db|whl|onnx|safetensors|pt|pth)$' -or
    $RelativePath -match '(^|/)(cookies?[^/]*\.txt|[^/]*cookie[^/]*\.json)$'
}

$gitDir = Join-Path $projectDir ".git"
$relativeFiles = @()
if (Test-Path -LiteralPath $gitDir) {
  # 首次初始化后文件尚未暂存，扫描必须同时覆盖已跟踪与未忽略的候选文件。
  $gitStatusOutput = @(& git -C $projectDir status --short --untracked-files=all 2>&1)
  $gitStatusSucceeded = $?
  if (-not $gitStatusSucceeded) {
    throw "Unable to refresh Git release candidates: $($gitStatusOutput -join ' ')"
  }
  $relativeFiles = @(& git -c core.quotepath=false -C $projectDir ls-files --cached --others --exclude-standard)
  $gitListSucceeded = $?
  if (-not $gitListSucceeded) {
    throw "Unable to collect Git release candidates."
  }
  foreach ($relativePath in $relativeFiles) {
    if (Test-ProhibitedPath -RelativePath $relativePath) {
      $problems.Add("Prohibited path is included in the public candidate set: $relativePath")
    }
  }
} else {
  $excludedSegments = @(
    "/.git/", "/node_modules/", "/.next/", "/.venv/", "/__pycache__/",
    "/evaluation/", "/docs/plans/", "/docs/handoffs/", "/backend/data/"
  )
  $relativeFiles = @(
    Get-ChildItem -LiteralPath $projectDir -Recurse -File | ForEach-Object {
      $relativePath = Convert-ToRelativePath -Path $_.FullName
      $wrappedPath = "/$relativePath"
      $excluded = $false
      foreach ($segment in $excludedSegments) {
        if ($wrappedPath.Contains($segment)) { $excluded = $true; break }
      }
      if (-not $excluded -and -not (Test-ProhibitedPath -RelativePath $relativePath)) {
        $relativePath
      }
    }
  )
  $warnings.Add("Git is not initialized; scanning the prospective public file set.")
}

$privateValues = [System.Collections.Generic.List[string]]::new()
$localEnvPath = Join-Path $projectDir "backend/.env"
if (Test-Path -LiteralPath $localEnvPath) {
  foreach ($line in Get-Content -LiteralPath $localEnvPath -Encoding UTF8) {
    if ($line -match '^\s*([A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|COOKIE_FILE|VAULT_DIR|DOWNLOAD_DIR))\s*=\s*(.+?)\s*$') {
      $value = $Matches[2].Trim().Trim('"').Trim("'")
      if ($value.Length -ge 5) { $privateValues.Add($value) }
    }
  }
}

$secretRules = @(
  @{ Name = "common API key"; Pattern = 'sk-[A-Za-z0-9_-]{16,}' },
  @{ Name = "GitHub Token"; Pattern = 'gh[pousr]_[A-Za-z0-9]{20,}' },
  @{ Name = "Google API Key"; Pattern = 'AIza[0-9A-Za-z_-]{30,}' },
  @{ Name = "private key header"; Pattern = ('-----BEGIN ' + 'PRIVATE KEY-----') }
)
$textExtensions = @(
  ".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".ps1",
  ".bat", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".css", ".html", ".example"
)

foreach ($relativePath in $relativeFiles) {
  $fullPath = Join-Path $projectDir $relativePath
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { continue }
  $fileInfo = Get-Item -LiteralPath $fullPath
  if ($fileInfo.Length -gt 100MB) {
    $warnings.Add("File is larger than 100 MB: $relativePath")
  }
  if ($textExtensions -notcontains $fileInfo.Extension.ToLowerInvariant() -and $fileInfo.Name -ne "LICENSE") {
    continue
  }

  $content = Get-Content -LiteralPath $fullPath -Raw -Encoding UTF8
  foreach ($rule in $secretRules) {
    if ($content -match $rule.Pattern) {
      $problems.Add("Possible $($rule.Name): $relativePath")
    }
  }
  foreach ($privateValue in $privateValues) {
    if ($content.Contains($privateValue)) {
      $problems.Add("Exact local private value found: $relativePath")
      break
    }
  }
}

Write-Host "Prospective public files: $($relativeFiles.Count)"
foreach ($warning in $warnings) { Write-Host "[INFO] $warning" -ForegroundColor Yellow }
if ($problems.Count -gt 0) {
  foreach ($problem in ($problems | Sort-Object -Unique)) {
    Write-Host "[BLOCKED] $problem" -ForegroundColor Red
  }
  exit 1
}

Write-Host "Public release scan passed: no known private values or prohibited paths found." -ForegroundColor Green
