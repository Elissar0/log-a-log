#!/usr/bin/env bash
set -uo pipefail

results_dir="$(realpath -m "${1:?usage: run-fixed-request-rate.sh RESULTS_DIR}")"
mkdir -p "$results_dir"

docker exec log-a-log-postgres-1 psql -U logalog -d logalog -Atc \
  'SELECT count(*) FROM logs' > "$results_dir/rows-before.txt"
docker exec log-a-log-postgres-1 psql -U logalog -d logalog -Atc \
  "SELECT relpersistence FROM pg_class WHERE relname = 'logs'" \
  > "$results_dir/table-persistence.txt"
docker inspect --format '{{.Name}},{{.HostConfig.NanoCpus}},{{.HostConfig.Memory}}' \
  log-a-log-api-1 log-a-log-postgres-1 > "$results_dir/container-caps.csv"

printf 'timestamp,container,cpu_percent,memory_usage,memory_percent\n' > "$results_dir/resources.csv"

sample_resources() {
  while true; do
    timestamp="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
    docker stats --no-stream \
      --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}' \
      log-a-log-api-1 log-a-log-postgres-1 \
      | while IFS= read -r line; do printf '%s,%s\n' "$timestamp" "$line"; done \
      >> "$results_dir/resources.csv"
    sleep 1
  done
}

sample_resources &
sampler_pid=$!

docker run --rm \
  --network log-a-log_default \
  -v "$(pwd)/load:/scripts:ro" \
  -v "$results_dir:/results" \
  -e BASE_URL=http://api:8080 \
  -e REQUEST_RATE=150 \
  -e BATCH_SIZE=100 \
  -e DURATION=2m \
  -e REQUEST_TIMEOUT=10s \
  -e PREALLOCATED_VUS=1800 \
  -e MAX_VUS=2500 \
  grafana/k6:0.54.0 run \
  --out json=/results/k6.json \
  /scripts/fixed-request-rate.js
benchmark_exit=$?

kill "$sampler_pid" 2>/dev/null || true
wait "$sampler_pid" 2>/dev/null || true

docker exec log-a-log-postgres-1 psql -U logalog -d logalog -Atc \
  'SELECT count(*) FROM logs' > "$results_dir/rows-after.txt"

exit "$benchmark_exit"
