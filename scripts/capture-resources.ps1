param([int]$Seconds = 60, [string]$Output = "performance-results/resources.csv")

New-Item -ItemType Directory -Force (Split-Path -Parent $Output) | Out-Null
"timestamp,container,cpu_percent,memory_usage,memory_percent" | Set-Content $Output
for ($i = 0; $i -lt $Seconds; $i++) {
  $timestamp = (Get-Date).ToUniversalTime().ToString("o")
  docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}' | ForEach-Object { "$timestamp,$_" | Add-Content $Output }
  Start-Sleep -Seconds 1
}
Write-Host "Wrote $Output"
