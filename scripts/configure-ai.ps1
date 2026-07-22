param(
  [switch]$FirstRunOnly
)

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $projectDir "backend"
$envPath = Join-Path $backendDir ".env"
$examplePath = Join-Path $backendDir ".env.example"
$uiPath = Join-Path $PSScriptRoot "configure-ai.zh-CN.json"
$ui = Get-Content -LiteralPath $uiPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($FirstRunOnly -and (Test-Path -LiteralPath $envPath)) {
  return
}

if (-not (Test-Path -LiteralPath $envPath)) {
  if (-not (Test-Path -LiteralPath $examplePath)) {
    throw ($ui.missingTemplate -f $examplePath)
  }
  Copy-Item -LiteralPath $examplePath -Destination $envPath
}

function Get-DotEnvMap {
  param([string]$Path)

  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
    if ($line -match '^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$') {
      $values[$Matches[1]] = $Matches[2].Trim()
    }
  }
  return $values
}

function Set-DotEnvEntry {
  param(
    [System.Collections.Generic.List[string]]$Lines,
    [string]$Name,
    [string]$Value
  )

  for ($index = 0; $index -lt $Lines.Count; $index++) {
    if ($Lines[$index] -match "^\s*$([regex]::Escape($Name))\s*=") {
      $Lines[$index] = "$Name=$Value"
      return
    }
  }
  $Lines.Add("$Name=$Value")
}

function Remove-DotEnvEntry {
  param(
    [System.Collections.Generic.List[string]]$Lines,
    [string]$Name
  )

  for ($index = $Lines.Count - 1; $index -ge 0; $index--) {
    if ($Lines[$index] -match "^\s*$([regex]::Escape($Name))\s*=") {
      $Lines.RemoveAt($index)
    }
  }
}

$current = Get-DotEnvMap -Path $envPath
$storedKey = [string]$current["AI_API_KEY"]
if ([string]::IsNullOrWhiteSpace($storedKey)) {
  $storedKey = [string]$current["DEEPSEEK_API_KEY"]
}

$provider = [string]$current["AI_PROVIDER"]
if ([string]::IsNullOrWhiteSpace($provider)) { $provider = "deepseek" }
$baseUrl = [string]$current["AI_BASE_URL"]
if ([string]::IsNullOrWhiteSpace($baseUrl)) {
  $baseUrl = [string]$current["DEEPSEEK_BASE_URL"]
}
if ([string]::IsNullOrWhiteSpace($baseUrl)) { $baseUrl = "https://api.deepseek.com" }
$model = [string]$current["AI_MODEL"]
if ([string]::IsNullOrWhiteSpace($model)) { $model = [string]$current["DEEPSEEK_MODEL"] }
if ([string]::IsNullOrWhiteSpace($model)) { $model = "deepseek-v4-pro" }
$fastModel = [string]$current["AI_FAST_MODEL"]
if ([string]::IsNullOrWhiteSpace($fastModel)) {
  $fastModel = [string]$current["DEEPSEEK_QA_FAST_MODEL"]
}
if ([string]::IsNullOrWhiteSpace($fastModel)) { $fastModel = "deepseek-v4-flash" }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = $ui.windowTitle
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(540, 430)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)

$title = New-Object System.Windows.Forms.Label
$title.Text = $ui.title
$title.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 16, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(28, 22)
$title.AutoSize = $true
$form.Controls.Add($title)

$description = New-Object System.Windows.Forms.Label
$description.Text = $ui.description
$description.Location = New-Object System.Drawing.Point(30, 62)
$description.Size = New-Object System.Drawing.Size(480, 38)
$form.Controls.Add($description)

function Add-FieldLabel {
  param([string]$Text, [int]$Top)
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Text
  $label.Location = New-Object System.Drawing.Point(30, $Top)
  $label.Size = New-Object System.Drawing.Size(130, 24)
  $form.Controls.Add($label)
}

Add-FieldLabel -Text $ui.providerLabel -Top 112
$providerInput = New-Object System.Windows.Forms.ComboBox
$providerInput.DropDownStyle = "DropDownList"
$providerInput.Items.AddRange([object[]]$ui.providers)
$providerInput.Location = New-Object System.Drawing.Point(165, 108)
$providerInput.Size = New-Object System.Drawing.Size(340, 26)
$providerInput.SelectedIndex = if ($provider -eq "deepseek") { 0 } else { 1 }
$form.Controls.Add($providerInput)

Add-FieldLabel -Text $ui.apiKeyLabel -Top 157
$keyInput = New-Object System.Windows.Forms.TextBox
$keyInput.Location = New-Object System.Drawing.Point(165, 153)
$keyInput.Size = New-Object System.Drawing.Size(340, 26)
$keyInput.UseSystemPasswordChar = $true
$form.Controls.Add($keyInput)

$keyStatus = New-Object System.Windows.Forms.Label
$keyStatus.Text = if ($storedKey) { $ui.configuredKeyHint } else { $ui.newKeyHint }
$keyStatus.ForeColor = [System.Drawing.Color]::DimGray
$keyStatus.Location = New-Object System.Drawing.Point(165, 181)
$keyStatus.Size = New-Object System.Drawing.Size(340, 22)
$form.Controls.Add($keyStatus)

Add-FieldLabel -Text $ui.baseUrlLabel -Top 216
$baseUrlInput = New-Object System.Windows.Forms.TextBox
$baseUrlInput.Text = $baseUrl
$baseUrlInput.Location = New-Object System.Drawing.Point(165, 212)
$baseUrlInput.Size = New-Object System.Drawing.Size(340, 26)
$form.Controls.Add($baseUrlInput)

Add-FieldLabel -Text $ui.modelLabel -Top 260
$modelInput = New-Object System.Windows.Forms.TextBox
$modelInput.Text = $model
$modelInput.Location = New-Object System.Drawing.Point(165, 256)
$modelInput.Size = New-Object System.Drawing.Size(340, 26)
$form.Controls.Add($modelInput)

Add-FieldLabel -Text $ui.fastModelLabel -Top 304
$fastModelInput = New-Object System.Windows.Forms.TextBox
$fastModelInput.Text = $fastModel
$fastModelInput.Location = New-Object System.Drawing.Point(165, 300)
$fastModelInput.Size = New-Object System.Drawing.Size(340, 26)
$form.Controls.Add($fastModelInput)

$skipButton = New-Object System.Windows.Forms.Button
$skipButton.Text = $ui.skipButton
$skipButton.Location = New-Object System.Drawing.Point(315, 365)
$skipButton.Size = New-Object System.Drawing.Size(90, 32)
$skipButton.Add_Click({
  $form.Tag = "skip"
  $form.Close()
})
$form.Controls.Add($skipButton)

$saveButton = New-Object System.Windows.Forms.Button
$saveButton.Text = $ui.saveButton
$saveButton.Location = New-Object System.Drawing.Point(415, 365)
$saveButton.Size = New-Object System.Drawing.Size(90, 32)
$saveButton.Add_Click({
  $candidateKey = $keyInput.Text.Trim()
  if ([string]::IsNullOrWhiteSpace($candidateKey) -and [string]::IsNullOrWhiteSpace($storedKey)) {
    [System.Windows.Forms.MessageBox]::Show($ui.missingKeyMessage, $ui.missingKeyTitle) | Out-Null
    return
  }

  $candidateUri = $null
  if (-not [Uri]::TryCreate($baseUrlInput.Text.Trim(), [UriKind]::Absolute, [ref]$candidateUri) -or $candidateUri.Scheme -notin @("http", "https")) {
    [System.Windows.Forms.MessageBox]::Show($ui.invalidUrlMessage, $ui.invalidUrlTitle) | Out-Null
    return
  }
  if ([string]::IsNullOrWhiteSpace($modelInput.Text) -or [string]::IsNullOrWhiteSpace($fastModelInput.Text)) {
    [System.Windows.Forms.MessageBox]::Show($ui.missingModelMessage, $ui.missingModelTitle) | Out-Null
    return
  }

  $form.Tag = "save"
  $form.Close()
})
$form.Controls.Add($saveButton)
$form.AcceptButton = $saveButton
$form.CancelButton = $skipButton

[void]$form.ShowDialog()
if ($form.Tag -ne "save") {
  Write-Host $ui.skippedConsole
  return
}

$selectedProvider = if ($providerInput.SelectedIndex -eq 0) { "deepseek" } else { "openai-compatible" }
$selectedKey = $keyInput.Text.Trim()
if ([string]::IsNullOrWhiteSpace($selectedKey)) { $selectedKey = $storedKey }

$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in Get-Content -LiteralPath $envPath -Encoding UTF8) { $lines.Add($line) }

Set-DotEnvEntry -Lines $lines -Name "AI_PROVIDER" -Value $selectedProvider
Set-DotEnvEntry -Lines $lines -Name "AI_API_KEY" -Value $selectedKey
Set-DotEnvEntry -Lines $lines -Name "AI_BASE_URL" -Value $baseUrlInput.Text.Trim().TrimEnd("/")
Set-DotEnvEntry -Lines $lines -Name "AI_MODEL" -Value $modelInput.Text.Trim()
Set-DotEnvEntry -Lines $lines -Name "AI_FAST_MODEL" -Value $fastModelInput.Text.Trim()

foreach ($legacyName in @(
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "DEEPSEEK_QA_FAST_MODEL"
)) {
  Remove-DotEnvEntry -Lines $lines -Name $legacyName
}

[System.IO.File]::WriteAllLines(
  $envPath,
  $lines,
  [System.Text.UTF8Encoding]::new($false)
)
Write-Host $ui.savedConsole
