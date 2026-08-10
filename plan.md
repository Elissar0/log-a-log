# Log Ingestion & Query Service — Implementation Plan

Status: ready to execute  
Architecture: [`arch.md`](./arch.md)  
Contract priority: the project brief is authoritative; if implementation assumptions conflict with it, update this plan and the architecture before coding further.

## 1. Definition of done

The project is complete when all of the following are true:

- `docker compose up` with no configuration starts PostgreSQL, applies migrations, and exposes a ready service at `localhost:8080`.
- `GET /health`, `POST /logs`, `GET /logs`, and `GET /logs/aggregate` match the required paths, status codes, boundary semantics, and JSON shapes.
- Mixed-validity ingestion accepts good entries and reports every bad entry by its original array index.
- A `200` ingestion response is sent only after a durable PostgreSQL commit; accepted logs are queryable within 20 seconds.
- Unknown query parameters and all `Authorization: Bearer <key>` values are ignored by the unauthenticated core service.
- Cursor pagination is stable and uses the `(timestamp, id)` keyset plus a canonical filter hash.
- Retention deletes expired rows in bounded `SKIP LOCKED` batches and cannot monopolize request connections.
- Under API 0.5 CPU / 256 MB and PostgreSQL 1 CPU / 1 GB limits, the measured system:
  - sustains at least 15,000 accepted logs/second;
  - serves 1 aggregation request/second during ingestion;
  - keeps aggregate-query p95 below 1 second around 1 million stored rows;
  - passes the 20-second visibility check;
  - has no growing application queue, dropped successful requests, or crashes.
- Stretch trials at 20,000 and 25,000 logs/second are attempted and reported separately from the baseline.
- CI passes linting, type checking, unit, integration, contract, image-build, and smoke-test jobs.
- The README contains real capped-resource measurements, query plans, design reasoning, limitations, and reproducible commands.

## 2. Delivery strategy

Build thin vertical slices that remain runnable. Each milestone ends with an objective gate; do not carry a broken contract or an unbounded hot path into the next milestone. Performance decisions remain provisional until the capped load test supplies measurements.

Suggested duration: 7–10 working days, leaving the final two days for performance iteration, documentation, and demo rehearsal.

| Milestone | Outcome | Suggested time |
|---|---|---:|
| 0 | Repository and quality-tool foundation | 0.5 day |
| 1 | Database, migrations, startup, and health | 1 day |
| 2 | Correct and durable ingestion | 1.5 days |
| 3 | Filtered query and cursor pagination | 1 day |
| 4 | Aggregation and retention | 1 day |
| 5 | Docker, CI/CD, and contract suite | 1 day |
| 6 | Capped load testing and optimization | 2–3 days |
| 7 | Documentation, release check, and demo | 1 day |

## 3. Milestone 0 — Bootstrap the repository

### Work

- [ ] Create `package.json`, `bun.lock`, strict `tsconfig.json`, formatter, and ESLint configuration.
- [ ] Pin a Bun version for local development, Docker, and GitHub Actions.
- [ ] Add scripts for `dev`, `start`, `build`, `typecheck`, `lint`, `format:check`, `test`, `test:integration`, and `migrate`.
- [ ] Install the minimum production dependencies: Fastify, `pg`, TypeBox/AJV, and a Bun-compatible UUIDv7 implementation.
- [ ] Prefer manual typed configuration parsing or the already-required schema tooling; do not add Zod to the ingestion path.
- [ ] Create the module layout from `arch.md`, plus `test`, `load`, and `scripts` directories.
- [ ] Add `.env.example`, `.dockerignore`, `.gitignore`, and an initial README skeleton.
- [ ] Add one Bun/Fastify/`pg` compatibility smoke test.

### Exit gate

- `bun install --frozen-lockfile`, lint, type checking, build, and `bun test` all succeed from a clean checkout.
- The production dependency list contains no unused framework or second JavaScript runtime.

## 4. Milestone 1 — Database, migrations, and readiness

### Work

- [ ] Implement validated configuration with defaults for port, database URL, pool sizes, request limits, retention, timeouts, and `AUTH_ENABLED=false`.
- [ ] Implement separate PostgreSQL pools:
  - write pool: maximum 2 connections;
  - query pool: maximum 2 connections;
  - maintenance pool: exactly 1 connection.
- [ ] Create a SQL migration runner with a session-level PostgreSQL advisory lock and `schema_migrations` ledger.
- [ ] Add the baseline migration for:
  - the `logs` table;
  - composite primary key `(timestamp, id)`;
  - `logs_service_page_idx`;
  - `logs_attributes_text_gin_idx`;
  - tuned table-level autovacuum settings.
- [ ] Implement startup ordering: validate config, connect, acquire migration lock, migrate, probe the database, start serving, mark ready.
- [ ] Implement bounded graceful shutdown for HTTP, write batches, retention, and database pools.
- [ ] Implement `GET /health`; it is always unauthenticated and returns `200` only when the database and schema are ready.

### Tests

- [ ] A clean database migrates successfully.
- [ ] A second migration runner waits safely and does not apply a migration twice.
- [ ] A migration failure prevents readiness.
- [ ] Database loss changes health/readiness behavior without exposing internal errors.
- [ ] Shutdown drains or explicitly fails pending work within its deadline.

### Exit gate

- Starting against an empty PostgreSQL 16 database produces the expected schema and a healthy endpoint without manual commands.

## 5. Milestone 2 — Ingestion

### 5.1 Contract validation

- [ ] Set Fastify's maximum request body to 2 MiB.
- [ ] Apply an eight-request ingestion admission limit before expensive normalization work.
- [ ] Handle malformed JSON as `400` without crashing or invoking entry validation.
- [ ] Validate the top-level `{ logs: [...] }` envelope and the 2,000-entry maximum.
- [ ] Define the log-entry schema with TypeBox and compile one AJV validator at startup.
- [ ] Validate each entry in a tight loop, preserving its original index and mapping AJV errors to deterministic reasons.
- [ ] Add explicit checks for strict ISO 8601 parsing and the five-minute future boundary using one captured `now` per request.
- [ ] Reject nested/null/array attribute values; permit only string, number, and boolean scalars.
- [ ] Preserve original attributes and build `attributes_text` with all scalar values converted to strings.
- [ ] Generate UUIDv7 IDs only for accepted entries.

### 5.2 Durable write path

- [ ] Implement the parameterized, typed-array `UNNEST` insert in the repository.
- [ ] Implement a bounded write batcher with these initial thresholds:
  - immediate flush at 500 accepted entries from one request;
  - coalesced flush at 1,000 entries, 1 MiB normalized payload, or 10 ms;
  - no transaction above 2,000 rows;
  - no more than 2 flush transactions in flight;
  - global queue cap of 10,000 entries or 8 MiB.
- [ ] Map coalesced requests to their transaction result and release each body/normalized payload promptly.
- [ ] Keep `synchronous_commit=on` and resolve HTTP responses only after `COMMIT` succeeds.
- [ ] On transaction failure, return `503` to every request in that transaction and report none of its rows as accepted.
- [ ] Reject overload with `503` before growing memory without bound.
- [ ] Ignore any `Authorization` header.

### Tests

- [ ] Valid single and multi-entry batches return the exact accepted/rejected shape.
- [ ] Mixed batches preserve good entries and report all invalid original indexes.
- [ ] An empty/all-invalid batch returns `400`; malformed JSON returns `400`.
- [ ] Strings, numbers, and booleans round-trip with their original types while normalized values are stored correctly.
- [ ] A successful response is not emitted before a controlled commit completes.
- [ ] A forced rollback leaves no rows from the affected transaction.
- [ ] Coalesced requests are all committed or all failed consistently.
- [ ] Boundary tests cover exactly five minutes ahead, Unicode, empty fields, large payloads, and nested attributes.
- [ ] A bearer header never changes the result.

### Exit gate

- Contract tests pass, durability is demonstrated by a forced commit delay/failure test, and a newly accepted marker is immediately queryable through a direct repository read.

## 6. Milestone 3 — Query and cursor pagination

### Work

- [ ] Implement a shared query-parameter parser independent of HTTP handlers and SQL generation.
- [ ] Validate recognized parameters; ignore and optionally count unknown parameters.
- [ ] Enforce `since <= timestamp < until`, valid levels, integer limits from 1 to 1,000, and rejection of repeated recognized scalar parameters.
- [ ] Combine multiple `attr.<key>` filters into one normalized JSONB containment value.
- [ ] Escape `%`, `_`, and `\` so `q` is a literal case-insensitive substring.
- [ ] Implement a SQL builder that emits only parameterized values and whitelisted SQL fragments.
- [ ] Implement versioned base64url cursors containing timestamp, UUID, and a SHA-256 hash of canonical filters.
- [ ] Reject malformed, unsupported-version, or cross-filter cursors with `400`.
- [ ] Query `limit + 1`, order by `(timestamp DESC, id DESC)`, and set `next_cursor` only when another row exists.
- [ ] Serialize timestamps consistently as UTC ISO 8601 strings and return original attribute value types.
- [ ] Ignore bearer headers on the endpoint.

### Tests

- [ ] Test every individual filter and representative combinations.
- [ ] Test equality across numeric/string/boolean normalized attributes.
- [ ] Test inclusive `since`, exclusive `until`, equal empty bounds, and invalid reversed bounds.
- [ ] Test duplicate timestamps across page boundaries with no duplicate or missing older rows.
- [ ] Test insertion between pages and document the non-snapshot behavior.
- [ ] Test cursor filter mismatch, tampering, invalid timestamps/UUIDs, and changed limit.
- [ ] Test literal wildcard characters, Unicode/case behavior, unknown parameters, and bearer headers.
- [ ] Assert SQL injection payloads remain bound values and never become SQL identifiers/fragments.

### Exit gate

- The full `GET /logs` contract suite passes against PostgreSQL, including concurrent-insert pagination tests.

## 7. Milestone 4 — Aggregation and retention

### 7.1 Aggregation

- [ ] Reuse the query filter parser and SQL predicate builder.
- [ ] Require `since`, `until`, and `bucket`.
- [ ] Map `1m`, `5m`, `1h`, and `1d` to hard-coded `date_bin` intervals.
- [ ] Map `group_by=service|level` to hard-coded column expressions; never interpolate arbitrary input.
- [ ] Return UTC-aligned, ascending buckets with deterministic secondary group ordering.
- [ ] Omit empty buckets and use `group: null` when ungrouped.
- [ ] Convert PostgreSQL int64 counts to JSON numbers only after a safe-integer check.
- [ ] Ignore unknown query parameters and bearer headers.

### 7.2 Retention

- [ ] Implement the single-leader worker using a session advisory lock on the maintenance connection.
- [ ] Calculate one cutoff per pass from `RETENTION_DAYS`.
- [ ] Delete up to 2,000 rows per transaction using the `(timestamp, id)` scan and `FOR UPDATE SKIP LOCKED`.
- [ ] Commit/yield between batches and apply bounded lock and statement timeouts.
- [ ] Stop cleanly during shutdown and retry transient failures on the next interval.
- [ ] Record rows deleted, batch latency, failures, and retention lag without logging message/attribute contents.

### Tests

- [ ] Test every bucket/group combination and all shared filters.
- [ ] Test UTC boundary alignment, empty results, invalid inputs, safe counts, and ordering.
- [ ] Test that two worker instances elect exactly one leader.
- [ ] Test expiration boundary correctness and multiple cleanup batches.
- [ ] Run ingestion concurrently with retention and assert no lost current rows or prolonged request waits.

### Exit gate

- Both endpoint and worker suites pass; representative aggregation and retention queries have recorded `EXPLAIN (ANALYZE, BUFFERS)` plans.

## 8. Milestone 5 — Containers, CI/CD, and contract verification

### Docker

- [ ] Create a multi-stage Dockerfile from a pinned official `oven/bun` image.
- [ ] Use `bun install --frozen-lockfile`, build for Bun, copy only runtime artifacts/migrations, and run as a non-root user.
- [ ] Create `docker-compose.yml` with PostgreSQL 16, a named volume, health checks, migration-aware API startup, and `8080:8080`.
- [ ] Make `AUTH_ENABLED=false` the zero-configuration default.
- [ ] Add a capped performance configuration with API 0.5 CPU / 256 MB and PostgreSQL 1 CPU / 1 GB.
- [ ] Verify plain `docker compose up` from a clean volume requires no manual setup.

### CI/CD

- [ ] Add a PR/push workflow for frozen install, formatting, lint, type check, `bun test`, PostgreSQL integration/contract tests, image build, and k6 smoke test.
- [ ] Run contract smoke tests explicitly with `AUTH_ENABLED=false` and a bearer header on all data endpoints.
- [ ] Add dependency caching keyed by Bun version and lock file without weakening frozen installs.
- [ ] Add a least-privilege main/tag workflow that builds, scans, and publishes immutable SHA/version images to GHCR.
- [ ] Ensure CI logs contain no database secrets or arbitrary ingested attributes.

### Exit gate

- A clean local Compose run and the CI workflow both pass the same contract smoke test.

## 9. Milestone 6 — Capped performance campaign

Performance work is a measured loop: establish a reproducible baseline, identify one bottleneck, change one material variable, and retain only changes with clear before/after evidence.

### 9.1 Build the harness

- [ ] Add a deterministic seed tool for approximately 1,000,000 logs distributed over about one month.
- [ ] Use realistic service/level skew, several scalar attribute keys/types, and searchable message terms.
- [ ] Add a k6 mixed workload that records attempted and accepted entries separately.
- [ ] Parameterize producer batch size and target entry rate.
- [ ] Generate exactly 1 aggregation request/second during ingestion.
- [ ] Add accepted-marker visibility probes with a hard 20-second failure threshold.
- [ ] Export ingestion/aggregation percentiles, queue depth, pool waits, and error counts.
- [ ] Capture API/PostgreSQL CPU, RSS, connections, disk/WAL growth, and Bun event-loop delay.
- [ ] Add scripts for warm-cache, cold-ish-cache, retention-overlap, and `EXPLAIN` capture runs.

### 9.2 Establish the baseline

- [ ] Run every scored test with the resource caps enforced.
- [ ] Warm up without counting the warm-up interval.
- [ ] Run at 15,000 entries/second for at least five steady-state minutes.
- [ ] Confirm aggregation rate is 1 request/second and p95 is below 1 second.
- [ ] Confirm all visibility probes are below 20 seconds.
- [ ] Confirm the write queue is stable rather than accumulating backlog.
- [ ] Record row-count bands so results near 1 million rows remain distinguishable as ingestion adds data.
- [ ] Attempt 20,000 and 25,000 entries/second only after the baseline passes.

### 9.3 Optimize in evidence order

1. Profile Bun JSON parsing, AJV validation, attribute normalization, UUID creation, and array assembly.
2. Compare producer batches of 500 and 1,000 entries.
3. Compare coalescing limits/timeouts around 500/1,000/2,000 entries and 5/10/20 ms.
4. Inspect commit latency, WAL rate, checkpoints, pool waits, and database CPU.
5. Compare the attribute GIN index present versus absent using both ingestion and `attr.*` aggregation tests.
6. Add the message trigram GIN migration only if `q` p95 fails; retain it only if ingestion still reaches 15,000/s.
7. Reassess the service B-tree and any proposed level/combined index through measured query benefit versus write cost.
8. Benchmark COPY only if protocol/statement overhead is material and the chosen implementation passes Bun compatibility and durability tests.
9. Consider partitioning or rollups only if the corresponding measured bottleneck remains after the simpler gates above.

### Performance gate

- Baseline requirements pass under caps for a stable five-minute window.
- The README has raw command lines, environment details, results, bottleneck diagnosis, retained optimizations, rejected experiments, and before/after tables.
- No claim is based on an uncapped or warm-up-only result.

## 10. Milestone 7 — Documentation and release

### README

- [ ] Add prerequisites and exact zero-configuration `docker compose up` steps.
- [ ] Document all required endpoints with valid, partial-invalid, invalid-query, pagination, and aggregation examples.
- [ ] State that auth is disabled, bearer headers are ignored, and health is unauthenticated.
- [ ] Explain raw/normalized JSONB attributes, keyset cursors, baseline indexes, and retention behavior.
- [ ] Document resource defaults, request/batch limits, timeouts, pool sizes, and overload behavior.
- [ ] Include the capped performance table and `EXPLAIN` evidence.
- [ ] Describe tested limitations: unrestricted-time message search, retry duplicates, non-snapshot pagination, and single-table retention scaling.
- [ ] Document safe configuration overrides without requiring any for the core service.

### Final verification

- [ ] Remove the local database volume using the documented cleanup command, then verify a completely clean Compose startup.
- [ ] Run the full CI-equivalent command sequence locally.
- [ ] Run the contract test with bearer headers and unknown additive parameters.
- [ ] Re-run the capped baseline after the final image build.
- [ ] Confirm migrations are immutable and rerunnable from an empty database.
- [ ] Confirm no credentials, generated load data, build output, or performance dumps are accidentally committed.
- [ ] Tag the tested image/commit and retain the matching performance report.

### Demo rehearsal

- [ ] Explain why Bun and compiled AJV were chosen for the 0.5 CPU hot path.
- [ ] Walk from `POST /logs` validation through durable commit and immediate query visibility.
- [ ] Decode a cursor and explain its keyset/filter-hash behavior.
- [ ] Run one representative `EXPLAIN (ANALYZE, BUFFERS)` and map it to the serving index.
- [ ] Demonstrate retention during ingestion.
- [ ] Show capped load results and one optimization that was rejected based on measurements.

## 11. Required test matrix

| Area | Minimum automated coverage |
|---|---|
| Health/startup | clean migration, database unavailable, migration failure, readiness transition |
| Ingest parsing | malformed JSON, wrong envelope, empty batch, oversized body/batch |
| Per-entry validation | timestamp, future bound, level, empty fields, flat scalar attributes, mixed batch indexes |
| Durability | delayed commit, rollback, connection loss, coalesced transaction failure |
| Query parsing | all recognized parameters, unknown ignored, repeated recognized rejected, invalid bounds/limit/level |
| Filter semantics | service, level, time, numeric/string/boolean attributes, literal substring, combinations |
| Pagination | tied timestamps, final page, malformed/cross-filter cursor, concurrent insert |
| Aggregation | all buckets, both groups, no group, empty range, filters, ordering, safe count conversion |
| Authorization | arbitrary bearer header accepted on all data routes; health without auth |
| Retention | cutoff boundary, multiple batches, advisory leader, concurrent ingest/query |
| Resources | body/admission/queue caps, pool reservation, overload response, graceful shutdown |
| Performance | 15k/s baseline, 1 aggregate/s, aggregate p95, visibility deadline, capped resources, stable queue |

## 12. Commit sequence

Keep commits small enough to review and bisect. A reasonable sequence is:

1. `chore: bootstrap bun typescript service`
2. `feat: add postgres migrations and readiness`
3. `feat: validate and ingest partial log batches`
4. `feat: add durable bounded write batching`
5. `feat: add filtered log queries and cursors`
6. `feat: add time bucket aggregation`
7. `feat: add concurrent retention worker`
8. `test: add contract and integration coverage`
9. `build: add docker compose and github workflows`
10. `perf: add capped load and explain harness`
11. `perf: tune measured ingestion and query bottlenecks`
12. `docs: publish usage design and benchmark results`

Do not combine generated benchmark numbers with the harness commit; measurements should be attributable to the exact implementation commit that produced them.

## 13. Decision log to complete during implementation

Record each decision in the README or a short `docs/decisions.md` table:

| Decision | Evidence required |
|---|---|
| Actual producer/flush thresholds | capped throughput, ingestion latency, queue stability, RSS |
| Keep/remove attribute GIN | `attr.*` p95 versus insert rate/WAL with and without index |
| Add/defer message trigram GIN | `q` p95 and capped insert rate before/after |
| Keep service B-tree | service-filter plan/latency versus write cost |
| UNNEST or COPY | Bun compatibility, throughput, CPU, memory, durability behavior |
| Single table or partitions | retention latency, vacuum impact, database size, aggregate p95 |
| Any rollup | exact query family helped and maintenance cost during 15k/s ingestion |

