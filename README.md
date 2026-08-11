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

PostgreSQL is the durable source of truth. `attributes` retains original JSON scalar types. Attribute filters use parameterized `attributes ->> $key = $value`, so `attr.retries=3` consistently matches numeric `3` and string `"3"` without duplicating every attribute bag. Queries use parameterized SQL only.

The primary key `(timestamp, id)` gives stable descending keyset pagination and retention scans, and `logs_service_page_idx` serves service pages. A generic attribute GIN and message trigram index are deliberately omitted: the capped experiments showed that the attribute GIN dominated write amplification, while unrestricted attribute/message filters remain valid parameterized scans. Cursors include a version, `(timestamp,id)`, and a canonical-filter hash; pagination is not a frozen snapshot while concurrent rows arrive.

Each flush is one parameterized `INSERT ... SELECT FROM UNNEST` statement. PostgreSQL's implicit transaction is atomic, the write connections force `synchronous_commit=on`, and a request is answered only after that statement commits. The eight-request admission semaphore is released after synchronous parse/validation; commit-waiting requests are bounded by the separate 10,000-entry/8 MiB write queue.

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
TARGET_RATE=15000 BATCH_SIZE=100 DURATION=5m k6 run load/mixed-workload.js
```

On PowerShell use `./scripts/run-performance.ps1`; `./scripts/capture-resources.ps1` writes Docker CPU/RSS samples, and `./scripts/explain.ps1 -Query aggregate` captures `EXPLAIN (ANALYZE, BUFFERS)` for each documented access pattern (`page`, `service-page`, `attribute`, `aggregate`).

### Capped performance record

The submitted baseline scored 43.924/100: 3,318 accepted logs/s, 31.54% HTTP errors, 274 ms ingestion p95, and 2.17 s aggregate p95. PostgreSQL averaged 75% CPU while the API averaged 15%, which led to the write-amplification experiments below.

Short local screening runs used the Compose caps, approximately 1M seeded rows, 100-log producer batches, a 15k/s target, one aggregate request/s, and periodic visibility probes. They are comparative 45-second screens, not substitutes for the required five-minute final run.

| Experiment                                 | Accepted logs/s | Aggregate p95 | Outcome                             |
| ------------------------------------------ | --------------: | ------------: | ----------------------------------- |
| Original code/harness reproduction         |           3,381 |        2.01 s | reproduced external bottleneck      |
| Release parse admission before commit wait |           4,785 |        2.83 s | retained                            |
| One implicit durable INSERT transaction    |           6,134 |        2.36 s | retained                            |
| Remove attribute GIN                       |           9,242 |        2.51 s | retained                            |
| Fresh raw-only attributes schema           |           8,099 |        2.59 s | retained; conservative final screen |
| Remove service index                       |           5,859 |        4.65 s | rejected                            |
| Add aggregate covering index               |           6,352 |        2.90 s | rejected                            |
| Synchronous rollup/upsert                  |           2,522 |        4.55 s | rejected (hot-key contention)       |
| Asynchronous commit                        |           1,502 |        7.33 s | rejected; durable commit restored   |

The retained changes materially improve the local screen but still miss the 15k/s and sub-second aggregate targets. Run the five-minute harness and capture fresh `EXPLAIN`/resource evidence on the grading host before making stronger claims. Keep raw k6 output and resource CSVs out of git (`performance-results/` is ignored).

## CI and images

Pull requests and pushes run frozen install, formatting, lint, typecheck, unit/integration tests against PostgreSQL, image build, and a short Compose/k6 smoke test. Pushes to `main` and version tags publish SHA/tag-addressable images to GHCR with least-privilege `packages: write`, then scan the pushed digest for high/critical vulnerabilities. CI uses test-only local database credentials and does not print ingested payloads.
