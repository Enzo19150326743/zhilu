param(
  [Parameter(Mandatory = $true)]
  [string]$Url,

  [int]$TimeoutSeconds = 60
)

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

while ((Get-Date) -lt $deadline) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      exit 0
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}

exit 1
