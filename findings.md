# Performance findings

## Executive summary

The submitted build scored **43.9244**. It passed every correctness and reliability check, but achieved only **3,318 accepted logs/s**, a **31.54% HTTP error rate**, and **2,172 ms aggregate p95 latency**. The largest application-side bottleneck was an admission semaphore that allowed only eight requests to remain in flight until their database commits completed. At the observed ingest p95, that imposed a throughput ceiling close to the submitted result.

The selected implementation releases that semaphore after synchronous parsing and validation, reduces every flush from five database round trips to one atomic statement, and removes a write-amplifying duplicate attributes column and GIN index. A corrected mixed-workload harness also measures visibility periodically instead of issuing a query after every successful POST.

The best local short screen reached **9,242 accepted logs/s**. A clean-volume run of the final raw-table design reached **8,099 accepted logs/s**, about **2.44x** the submitted throughput. These are local screening results, not a claim of a new official score.

## Requirements guardrails

All retained changes preserve the requirements in `reqs.md`:

- A successful `POST /logs` still means the accepted rows committed successfully.
- Malformed envelopes and invalid individual records keep their specified behavior.
- Query filtering, cursor pagination, aggregation, retention, health checks, and response shapes remain intact.
- Raw attributes remain JSONB and attribute equality still compares their textual scalar representation.
- Resource limits, the single application process, and PostgreSQL remain unchanged.
- The maximum of eight concurrent ingestion parsing/validation operations is preserved. Requests waiting for a batch commit are bounded by the existing write queue instead of consuming parser slots.

`arch.md` was updated to describe the selected implementation because the user explicitly authorized architectural experiments where requirements are preserved.

## Test method and limitations

The official submission result is the baseline. Local experiments used Docker Compose with the project resource limits, PostgreSQL, 100-log POST batches, about one million seeded rows where applicable, one aggregate request per second, and a dedicated low-rate visibility scenario. Most screens ran for roughly 45 seconds.

These are controlled ranking experiments rather than replicas of the official grader. Absolute values can vary with Docker Desktop, database cache warmth, table/index bloat, and the exact generated query distribution. Runs marked **reused** inherited prior writes and are useful only as negative screens; clean-volume results receive more weight. The original local harness issued a visibility query after every successful POST and materially distorted the workload, so only its baseline is reported and all later experiments use periodic visibility.

Accepted logs/s is `accepted records / measured wall-clock duration`, not request arrival rate. HTTP success is the fraction of POST requests that returned success during the fixed-duration load stage.

## Official submission baseline

| Metric                              |           Result |
| ----------------------------------- | ---------------: |
| Overall score                       |          43.9244 |
| Correctness                         |          15 / 15 |
| Reliability                         |          20 / 20 |
| Query score                         |         4.5 / 15 |
| Performance score                   |       4.424 / 50 |
| Accepted throughput                 |  3,318.33 logs/s |
| POST success                        |           76.27% |
| HTTP error rate                     |           31.54% |
| Ingest p95                          |        274.46 ms |
| Aggregate p95                       |         2,172 ms |
| Eventual-consistency missing/failed |   25,200 records |
| Application CPU, average            |           15.36% |
| PostgreSQL CPU, average / maximum   | 75.06% / 106.51% |

The low application CPU alongside saturated PostgreSQL and the approximately eight-request throughput ceiling pointed to database wait time and write amplification, not JSON parsing capacity, as the principal constraints.

## Experiments

| ID       | Change under test                                                                       | Data state                              | Accepted logs/s | POST success | Aggregate p95 | Outcome                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------- | --------------------------------------- | --------------: | -----------: | ------------: | ------------------------------------------------------------------------------------------------------------------------- |
| E0       | Submitted implementation; official grader                                               | Official                                |           3,318 |       76.27% |        2.17 s | Baseline                                                                                                                  |
| E0-local | Original code and original per-POST visibility harness                                  | Reused, ~1M rows                        |           3,381 |       25.24% |        2.01 s | Harness was query-heavy and unsuitable for comparisons                                                                    |
| E1       | Release the eight-slot admission guard after parse/validation                           | Reused, ~1M rows                        |           4,785 |       36.33% |        2.83 s | Retained; removed the artificial commit-wait ceiling                                                                      |
| E2       | Replace `BEGIN` + `SET LOCAL` + `INSERT` + `COMMIT` with one atomic `INSERT ... UNNEST` | Reused, ~1M rows                        |           6,134 |       45.25% |        2.36 s | Retained; eliminated four round trips per flush                                                                           |
| E3       | Drop the service/time index                                                             | Reused, ~1M rows                        |           5,859 |       45.57% |        4.65 s | Rejected; aggregate latency regressed sharply                                                                             |
| E4       | Drop the generic attributes GIN index                                                   | Reused, ~1M rows                        |       **9,242** |       66.18% |        2.51 s | Direction retained through the raw-only schema; best short screen                                                         |
| E5       | Raw-only attributes schema: remove duplicate normalized JSONB column and its GIN index  | Fresh, ~1M rows                         |       **8,099** |       61.85% |        2.59 s | Retained; conservative representative result                                                                              |
| E6       | Add covering `(timestamp) INCLUDE (service)` index                                      | Reused, ~1M rows                        |           6,352 |       47.99% |        2.90 s | Rejected; extra write cost did not buy enough query latency                                                               |
| E7       | Synchronous upsert rollup table                                                         | Fresh seed attempt, then fixed ordering |           2,522 |       26.91% |        4.55 s | Rejected; hot-key contention, and the first seed deadlocked at ~680k rows                                                 |
| E8       | Append-only rollup table                                                                | Experimental                            |           1,632 |       19.95% |        5.77 s | Rejected; write and query amplification both worsened                                                                     |
| E9       | Dedicated aggregate pool plus larger read pool                                          | Heavily reused/bloated                  |           1,351 |       14.96% |        4.32 s | Rejected; no benefit in the adverse screen; result is not clean-run comparable                                            |
| E10      | Queue 50k/32 MiB plus asynchronous commit                                               | Fresh                                   |           6,938 |      100.00% |        3.30 s | Rejected; all POSTs completed but VU waits/dropped iterations hid overload and throughput stayed below the simpler design |
| E11      | Asynchronous commit with original 10k queue                                             | Heavily reused/bloated                  |           1,502 |       18.35% |        7.33 s | Rejected; durability semantics were weaker and the screen regressed                                                       |

Additional observations:

- E1 processed 219,800 accepted records in 45.9 seconds; E2 processed 288,500 in 47.0 seconds; E4 processed 428,600 in 46.4 seconds; and E5 processed 382,900 in 47.3 seconds.
- Original-schema seeding of roughly one million rows took about 178.6 seconds. The fresh raw-only schema seeded in about 59.6 seconds, showing that the removed duplicate JSONB transformation and GIN maintenance were major write costs.
- E4 had no aggregate errors and one visibility failure. E5 had a 2.32% aggregate error rate and four visibility failures, predominantly because the visibility POST itself was rejected by overload admission rather than because an acknowledged record was lost.
- E10 reported 3,352 dropped iterations. Its 100% POST success therefore does not mean it sustained the offered arrival rate.
- The later E9 and E11 screens used a heavily rewritten volume. Their low absolute numbers should not be compared directly with fresh E5; they are sufficient to reject those changes without attributing the entire difference to the code change.

## Why the selected changes help

### Admission scope

Previously, each of the eight admitted requests held its slot while awaiting the shared batch commit. With roughly 100 logs per request and 274 ms submitted ingest p95, a simple ceiling estimate is:

`8 requests * 100 logs / 0.274 seconds ~= 2,920 logs/s`

That is close to the official 3,318 logs/s. Releasing the slot after CPU-bound validation allows the batcher to form larger flushes while the existing record/byte queue remains the overload boundary. An `onResponse` fallback prevents malformed JSON from leaking a slot.

### One-statement flushes

PostgreSQL statements are atomic without an explicit client-managed transaction. The former flush path made separate `BEGIN`, `SET LOCAL`, `INSERT`, and `COMMIT` calls. The new path makes one parameterized `INSERT ... SELECT FROM UNNEST` call while keeping synchronous commit enabled for the write pool. This preserves success-after-commit semantics and removes network/protocol overhead from every flush.

### Raw-only attributes

The old path recursively normalized each attributes object, serialized both raw and normalized forms, stored both JSONB values, and maintained a large GIN index. Exact scalar equality can instead use `attributes ->> key = value`, with both key and value parameterized. Removing the duplicate column and generic GIN significantly reduces CPU, WAL, storage, and index maintenance. The service/time index stays because dropping it caused aggregate p95 to rise from the low-two-second range to 4.65 seconds.

### Load harness visibility

Visibility is an eventual-consistency probe, not part of every ingest transaction. The old harness queried a marker immediately after every successful POST, creating a read workload proportional to write throughput and feeding its latency back into ingest. The revised harness runs a separate visibility scenario once every five seconds while retaining explicit visibility-failure thresholds.

## Selected implementation

Retained:

- Parse/validation-scoped eight-request admission with response cleanup fallback.
- A bounded batch queue for requests waiting on a durable write.
- One atomic PostgreSQL statement per flush and synchronous commit on the write pool.
- Raw JSONB attributes only; scalar equality through parameterized `->>` predicates.
- Service/time, timestamp/id, and retention indexes; no generic attributes GIN.
- Periodic, independent visibility checks in the mixed workload.
- Migration timeout disabled locally during migrations so API query timeouts cannot interrupt schema upgrades.

Rejected and removed:

- Dropping the service/time index.
- Covering timestamp index.
- Synchronous and append-only rollups.
- Dedicated aggregate pool.
- Oversized queue and asynchronous commit.

## Remaining performance risk and next experiments

The selected result is a substantial improvement but does not reach the 15,000 logs/s target in the local screen, and aggregate p95 remains above the one-second target. The next useful work should use a clean database and the exact official query distribution:

1. Capture `EXPLAIN (ANALYZE, BUFFERS, WAL)` for the official aggregate and filtered-query shapes at one million and ten million rows.
2. Measure larger application batches while keeping the same queue byte limit and durability semantics.
3. Compare the current array/`UNNEST` insert with PostgreSQL binary `COPY` using a dedicated connection and explicit commit acknowledgment.
4. Test targeted expression indexes only for attribute keys that actually occur in the official workload; a generic GIN was too expensive.
5. Tune PostgreSQL checkpoint/WAL settings inside the fixed memory and CPU limits, then rerun on a fresh volume.

No external score projection is made from these local runs. The official grader should be rerun against the selected code to obtain a comparable score.
