param([int]$Rate = 15000, [int]$BatchSize = 500, [string]$Duration = "5m")

docker compose up --build -d --wait
try {
  $env:BASE_URL = "http://localhost:8080"; $env:TARGET_RATE = $Rate; $env:BATCH_SIZE = $BatchSize; $env:DURATION = $Duration
  k6 run load/mixed-workload.js
} finally {
  Remove-Item Env:BASE_URL -ErrorAction SilentlyContinue
  docker compose down
}
