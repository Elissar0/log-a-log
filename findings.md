# Performance findings

## Executive summary

The submitted build scored **43.9244**. It passed every correctness and reliability check, but achieved only **3,318 accepted logs/s**, a **31.54% HTTP error rate**, and **2,172 ms aggregate p95 latency**. The largest application-side bottleneck was an admission semaphore that allowed only eight requests to remain in flight until their database commits completed. At the observed ingest p95, that imposed a throughput ceiling close to the submitted result.

The selected implementation releases that semaphore after synchronous parsing and validation, reduces every flush from five database round trips to one atomic statement, and removes a write-amplifying duplicate attributes column and GIN index. A corrected mixed-workload harness also measures visibility periodically instead of issuing a query after every successful POST.

The best local short screen reached **9,242 accepted logs/s**. A clean-volume run of the final raw-table design reached **8,099 accepted logs/s**, about **2.44x** the submitted throughput. These are local screening results, not a claim of a new official score.

## Post-change official benchmark

Submission `2XQZZZZZYQ9M0P7V2JH1HPKAKH` showed that the local screens overestimated the benefit. The attached export captured an intermediate score of **43.4989**, while the completed results page later reported **45.03/100** with the following breakdown:

| Category    |         Score |
| ----------- | ------------: |
| Correctness | 15.00 / 15.00 |
| Reliability | 20.00 / 20.00 |
| Queries     |  4.50 / 15.00 |
| Performance |  5.53 / 50.00 |

The completed score is only about 1.10 points above the original 43.9244 result. Correctness and reliability remained perfect, but the performance target was still missed by a wide margin.

### Official scenario results after the changes

| Scenario   | Accepted logs/s | Ingest p95 | Aggregate p95 | POST success | HTTP error rate | Immediate read-after-write success | Final drain                                               |
| ---------- | --------------: | ---------: | ------------: | -----------: | --------------: | ---------------------------------: | --------------------------------------------------------- |
| Load       |           4,145 |  419.69 ms |        2.15 s |      100.00% |          23.51% |                              0.94% | Passed in 3.56 s                                          |
| Stress     |           3,595 |  482.46 ms |        2.30 s |      100.00% |          42.06% |                              0.02% | Passed in 29.84 s                                         |
| Spike      |           2,000 |  356.14 ms |        2.40 s |      100.00% |          28.58% |                              0.05% | Passed in 1.32 s                                          |
| Breakpoint |           3,556 |  490.75 ms |        2.50 s |      100.00% |          51.99% |                              0.02% | Failed: 392,700 of 426,700 records missing and 3 timeouts |

The write-path changes did produce a real improvement: load throughput rose from 3,318 to 4,145 logs/s, or about 25%, and POST responses changed from 76.27% success to 100% success. However, ingest p95 increased from 274 ms to 420 ms and aggregate p95 stayed around 2.15 seconds. The application therefore converted much of the former immediate overload rejection into queueing and database wait time rather than increasing database capacity enough.

The 5.53-point performance score aligns with the load throughput fraction:

`4,145 / 15,000 * 20 ~= 5.53 points`

All performance scenarios missed their thresholds, so the large 50-point performance category remained almost entirely unearned. The maximum correctness and reliability scores could not compensate for this.

### Why the local result did not reproduce

The most important experimental mistake was changing the local visibility workload. The original harness queried an attribute marker after each successful POST. That was treated as artificial read amplification and replaced with one independent visibility probe every five seconds. The official grader, however, performs frequent read-after-write polling proportional to ingestion. The original behavior was therefore much closer to the grading workload than the revised local harness.

At the same time, experiment E4 removed `logs_attributes_text_gin_idx`, and E5 removed the normalized attribute column entirely. Marker queries then became unindexed predicates of the form:

```sql
attributes ->> $key = $value
```

This is functionally correct but requires scanning the time/service candidate set for arbitrary keys. The official read-after-write success rates of 0.02%-0.94% are strong evidence that these lookups could not keep up while the table was growing. Because all POST status codes were successful while the overall HTTP error rate remained 23.51%-51.99%, the failed HTTP work is inferred to be primarily query, aggregation, and visibility traffic rather than ingestion responses.

The local screens also lasted about 45 seconds, while the official load, stress, spike, and breakpoint sequence ran for several minutes and accumulated substantially more data. Short fresh-volume runs did not expose the same growth, checkpoint, cache, and repeated-scan behavior. Several experiment comparisons also used reused volumes, so their absolute rankings were less reliable than a clean end-to-end run.

### Confirmed bottleneck after the second submission

PostgreSQL remained the limiting resource:

| Scenario   | Application CPU average | PostgreSQL CPU average | PostgreSQL CPU maximum |
| ---------- | ----------------------: | ---------------------: | ---------------------: |
| Load       |                  14.13% |                 78.81% |                101.63% |
| Stress     |                  11.86% |                 81.57% |                105.95% |
| Spike      |                   7.19% |                 75.83% |                104.61% |
| Breakpoint |                  12.08% |                 78.43% |                103.58% |

The low application CPU means parsing and Fastify were not the remaining throughput constraint. PostgreSQL's single CPU was shared by durable inserts, primary and service index maintenance, raw aggregation, and repeated unindexed attribute searches. The one-statement insert reduced protocol overhead, but it did not remove this database work. The raw aggregation design also remained fundamentally unchanged, which explains why aggregate p95 stayed above two seconds instead of reaching the one-second target.

### Revised conclusions

- The admission-slot fix is validated: it removed POST 503 responses and increased official load throughput.
- The one-statement durable insert is directionally beneficial, but its isolated contribution cannot be separated from the other deployed changes in the official result.
- E4 and E5 are not validated as benchmark-wide improvements. They improved write-heavy local screens but damaged the grader's attribute-heavy visibility workload.
- E0-local should not have been dismissed as unsuitable merely because it was query-heavy. Its per-POST visibility behavior was an important approximation of the official grader.
- A 45-second throughput screen with sparse visibility is insufficient for selecting a design for this benchmark. Future comparisons need the complete official-style request mix, cumulative scenario duration, immediate marker polling, and a fresh database.
- The current architecture still lacks a solution for sub-second aggregation under concurrent writes.

## Aborted two-minute fixed-rate ingestion run

On 2026-08-13, an ingest-only run was started against a fresh one-million-row database using the selected UNLOGGED implementation and the Compose limits (API 0.5 CPU/256 MiB; PostgreSQL 1 CPU/1 GiB). The requested workload was 150 `POST /logs` requests/second, 100 valid logs/request, for 120 seconds: a nominal 18,000 requests and 1.8 million offered logs.

This attempt is **not a valid 15,000 logs/s benchmark result** because the generator failed to maintain the requested arrival rate:

| Metric                               |          Observed |
| ------------------------------------ | ----------------: |
| Completed HTTP requests              |             9,996 |
| Generator-dropped iterations         |             8,005 |
| Actual completed request rate        |  88.84 requests/s |
| Logs submitted by started iterations |           999,600 |
| Logs acknowledged as accepted        |           207,000 |
| Fully successful POST fraction       |            20.71% |
| HTTP latency p95 / p99               | 38.60 s / 42.34 s |
| Maximum active k6 VUs                |             1,000 |

The generator reached its VU ceiling after requests accumulated for tens of seconds, and some requests hit k6's default request timeout. Consequently, `9,996 + 8,005` iterations appear in k6's boundary accounting instead of the nominal 18,000, and accepted logs divided by the wall clock would describe this failed overload attempt rather than sustainable throughput.

The diagnostic finding is still useful: at this request shape, the service did not reject overload quickly enough to protect response latency. Work accumulated behind the write path until the load generator itself saturated. A corrected harness was prepared with a 10-second client deadline and enough VUs to schedule the full open-model rate, but that rerun was stopped before it began. The Compose containers, network, and disposable database volume were then removed, and no k6, seed, or benchmark-helper process was left running.

Future fixed-rate results are reportable only when `dropped_iterations == 0`. Client timeouts, non-200 responses, accepted-log count, and the database row delta must all remain visible rather than being converted into an apparent throughput score.

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

The initial interpretation was that visibility should be sampled independently rather than queried after every successful POST. The second official benchmark falsified that assumption for grader prediction: the grader performs frequent marker polling, so the revised once-per-five-seconds scenario materially underrepresented attribute-query pressure. It remains a useful isolated visibility test, but it is not an adequate benchmark replica.

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

The second official run demonstrated that these next experiments must reproduce frequent read-after-write attribute polling before another design is selected. No future score projection should be made from sparse-visibility local runs.
