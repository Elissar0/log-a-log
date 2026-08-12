param(
  [int]$Rate = 15000,
  [int]$BatchSize = 100,
  [string]$Duration = "5m",
  [int]$SeedCount = 1000000,
  [switch]$KeepVolume
)

if (-not $KeepVolume) { docker compose down -v --remove-orphans }
docker compose up --build -d --wait
try {
  $env:BASE_URL = "http://localhost:8080"
  $env:COUNT = $SeedCount
  $env:BATCH_SIZE = 1000
  $env:CONCURRENCY = 4
  bun load/seed.ts
  if ($LASTEXITCODE -ne 0) { throw "seed failed with exit code $LASTEXITCODE" }

  $env:TARGET_RATE = $Rate
  $env:BATCH_SIZE = $BatchSize
  $env:DURATION = $Duration
  $env:VISIBILITY_MODE = "per_post"
  k6 run load/mixed-workload.js
  $benchmarkExit = $LASTEXITCODE
} finally {
  Remove-Item Env:BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:COUNT -ErrorAction SilentlyContinue
  Remove-Item Env:CONCURRENCY -ErrorAction SilentlyContinue
  Remove-Item Env:TARGET_RATE -ErrorAction SilentlyContinue
  Remove-Item Env:BATCH_SIZE -ErrorAction SilentlyContinue
  Remove-Item Env:DURATION -ErrorAction SilentlyContinue
  Remove-Item Env:VISIBILITY_MODE -ErrorAction SilentlyContinue
  docker compose down
}
if ($benchmarkExit -ne 0) { exit $benchmarkExit }
