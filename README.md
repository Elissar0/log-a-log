# Log-a-log

Log-a-log is a Bun/Fastify/PostgreSQL service for durable structured-log ingestion, filtering, cursor pagination, aggregation, and bounded retention. The core API is unauthenticated: bearer headers are deliberately ignored and `GET /health` is always unauthenticated.

## Quick start

Prerequisites: Docker Compose v2. No configuration is required.

```sh
docker compose up --build
curl http://localhost:8080/health
```

The API listens on host port 8080. Startup waits for PostgreSQL health, then runs the immutable SQL migrations under a PostgreSQL advisory lock before starting the server. To start again from an empty database (this deletes local Compose data):

```sh
docker compose down -v
docker compose up --build
```

Copy `.env.example` only to override defaults. `AUTH_ENABLED` must remain `false`.

## API

Ingest a mixed-validity batch. Valid siblings commit even when an entry is rejected; a `200` is returned only after the transaction commits.

```sh
curl -X POST http://localhost:8080/logs \
  -H 'content-type: application/json' -H 'authorization: Bearer ignored' \
  -d '{"logs":[{"timestamp":"2026-07-20T14:32:01.123Z","level":"error","service":"checkout","message":"payment declined","attributes":{"user_id":"42","retries":3}},{"level":"critical"}]}'
# {"accepted":1,"rejected":[{"index":1,"reason":"..."}]}
```

Malformed JSON and all-invalid batches return `400`. Every entry needs an ISO timestamp no more than five minutes in the future, one of `debug|info|warn|error`, non-empty `service` and `message`, and optional flat scalar attributes (string, number, boolean).

```sh
# Filter and paginate. next_cursor is null on the last page.
curl 'http://localhost:8080/logs?service=checkout&attr.retries=3&q=declined&limit=100'

# Invalid recognized parameters return 400; unknown additive parameters are ignored.
curl 'http://localhost:8080/logs?level=critical'

# Time-bucketed aggregation; since, until, and bucket are required.
curl 'http://localhost:8080/logs/aggregate?since=2026-07-20T14:00:00Z&until=2026-07-20T15:00:00Z&bucket=1m&group_by=service'
```

`GET /logs` supports freely combinable `service`, `level`, inclusive `since`, exclusive `until`, `attr.<key>`, literal case-insensitive `q`, `limit` (1–1000, default 100), and `cursor`. Aggregation accepts the same filters plus buckets `1m`, `5m`, `1h`, or `1d`, and optional `group_by=service|level`.

## Design and operating limits

PostgreSQL is the durable source of truth. `attributes` retains original JSON scalar types; a second `attributes_text` JSONB stores their string forms so `attr.retries=3` consistently matches numeric `3` and string `"3"`. Queries use parameterized SQL only.

The primary key `(timestamp, id)` gives stable descending keyset pagination and retention scans. `logs_service_page_idx` serves service pages; `logs_attributes_text_gin_idx` serves attribute containment. The message trigram index is intentionally deferred until measurements demonstrate it is necessary. Cursors include a version, `(timestamp,id)`, and a canonical-filter hash; pagination is not a frozen snapshot while concurrent rows arrive.

Initial safe limits are: 2 MiB request bodies, 2,000 logs/request, eight concurrent ingestion requests, a 10,000-entry/8 MiB write queue, up to two write flushes, write/query pools of two connections each, one maintenance connection, and retention in 2,000-row `SKIP LOCKED` batches. Saturation returns `503` instead of unbounded memory growth. The Compose caps are API 0.5 CPU/256 MiB and PostgreSQL 1 CPU/1 GiB.

Known limitations: unrestricted-time message substring search can be expensive; client retries can create duplicate log records; keyset pagination is non-snapshot; and delete-based single-table retention may need partitioning at materially larger retention volumes.

## Testing, load, and query-plan evidence

```sh
bun install --frozen-lockfile
bun run format:check && bun run lint && bun run typecheck && bun test
bun run migrate && bun run test:integration

# Deterministic, approximately 1M-row seed over 30 days.
COUNT=1000000 BATCH_SIZE=1000 CONCURRENCY=4 bun load/seed.ts

# Five-minute capped workload: requested rate, accepted count, aggregate p95,
# and <20 second marker visibility are emitted by k6.
TARGET_RATE=15000 BATCH_SIZE=500 DURATION=5m k6 run load/mixed-workload.js
```

On PowerShell use `./scripts/run-performance.ps1`; `./scripts/capture-resources.ps1` writes Docker CPU/RSS samples, and `./scripts/explain.ps1 -Query aggregate` captures `EXPLAIN (ANALYZE, BUFFERS)` for each documented access pattern (`page`, `service-page`, `attribute`, `aggregate`).

### Capped performance record

All values are **UNMEASURED** until a run on the final image under the stated Compose caps is recorded. No throughput or latency result is claimed here.

| Trial | Entry rate | Aggregate p95 | Visibility max | Queue stability | Status |
|---|---:|---:|---:|---|---|
| Baseline (1M rows, 15k/s, 5 min) | UNMEASURED | UNMEASURED | UNMEASURED | UNMEASURED | not run |
| Stretch 20k/s | UNMEASURED | UNMEASURED | UNMEASURED | UNMEASURED | not run |
| Stretch 25k/s | UNMEASURED | UNMEASURED | UNMEASURED | UNMEASURED | not run |

The same applies to `EXPLAIN` evidence: capture it with the script above before deciding whether to retain, remove, or add an index. Keep raw k6 output and resource CSVs out of git (`performance-results/` is ignored).

## CI and images

Pull requests and pushes run frozen install, formatting, lint, typecheck, unit/integration tests against PostgreSQL, image build, and a short Compose/k6 smoke test. Pushes to `main` and version tags publish SHA/tag-addressable images to GHCR with least-privilege `packages: write`, then scan the pushed digest for high/critical vulnerabilities. CI uses test-only local database credentials and does not print ingested payloads.
