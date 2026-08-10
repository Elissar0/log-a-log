import { afterAll, beforeAll, expect, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { runMigrations } from "../../src/db/migrate";
import { closeDatabasePools, createDatabasePools } from "../../src/db/pool";
import type { DatabasePools } from "../../src/db/pool";
import { WriteBatcher } from "../../src/ingest/batcher";
import { PgLogWriteRepository } from "../../src/ingest/repository";
import { PgLogQueryRepository } from "../../src/query/repository";
import type { Readiness } from "../../src/routes/health";

interface LogResponse {
  readonly logs: {
    readonly id: string;
    readonly timestamp: string;
    readonly service: string;
    readonly message: string;
    readonly attributes: Record<string, unknown>;
  }[];
  readonly next_cursor: string | null;
}

interface AggregateResponse {
  readonly buckets: {
    readonly start: string;
    readonly group: string | null;
    readonly count: number;
  }[];
}

let app: FastifyInstance | undefined;
let pools: DatabasePools | undefined;
let batcher: WriteBatcher | undefined;

beforeAll(async () => {
  const config = loadConfig(process.env);
  pools = createDatabasePools(config);
  await runMigrations(pools.maintenance);
  await pools.maintenance.query("TRUNCATE TABLE logs");

  const readiness: Readiness = { ready: false };
  batcher = new WriteBatcher(new PgLogWriteRepository(pools.write), {
    maxQueuedEntries: config.maxQueuedEntries,
    maxQueuedBytes: config.maxQueuedBytes,
    flushEntries: config.flushEntries,
    flushBytes: config.flushBytes,
    flushDelayMs: config.flushDelayMs,
    immediateFlushEntries: config.immediateFlushEntries,
    maxTransactionEntries: config.maxLogsPerRequest,
    maxConcurrency: config.maxFlushConcurrency,
  });
  app = buildApp({
    config,
    pools,
    batcher,
    queryRepository: new PgLogQueryRepository(pools.query),
    readiness,
  });
  await app.ready();

  const starting = await app.inject({ method: "GET", url: "/health" });
  expect(starting.statusCode).toBe(503);
  readiness.ready = true;
});

afterAll(async () => {
  if (app !== undefined) await app.close();
  if (batcher !== undefined) await batcher.close();
  if (pools !== undefined) await closeDatabasePools(pools);
});

test("serves the required ingestion, query, pagination, and aggregate contract", async () => {
  if (app === undefined) throw new Error("test app was not initialized");

  const healthy = await app.inject({ method: "GET", url: "/health" });
  expect(healthy.statusCode).toBe(200);

  const malformed = await app.inject({
    method: "POST",
    url: "/logs",
    headers: { "content-type": "application/json" },
    payload: "{",
  });
  expect(malformed.statusCode).toBe(400);
  expect(json<{ error: string }>(malformed)).toEqual({ error: "malformed JSON" });

  const allInvalid = await app.inject({
    method: "POST",
    url: "/logs",
    payload: { logs: [{ timestamp: "not-a-date", level: "nope", service: "", message: "" }] },
  });
  expect(allInvalid.statusCode).toBe(400);
  expect(json<{ accepted: number }>(allInvalid).accepted).toBe(0);

  const timestamp = "2026-07-20T14:00:00.000Z";
  const ingest = await app.inject({
    method: "POST",
    url: "/logs",
    headers: { authorization: "Bearer ignored", "content-type": "application/json" },
    payload: {
      logs: [
        {
          timestamp,
          level: "info",
          service: "checkout",
          message: "100%_Ready",
          attributes: { retries: 3, enabled: true },
        },
        {
          timestamp,
          level: "critical",
          service: "checkout",
          message: "invalid sibling",
        },
        {
          timestamp,
          level: "error",
          service: "checkout",
          message: "100%_Ready second",
          attributes: { retries: "3", enabled: false },
        },
        {
          timestamp: "2026-07-20T13:59:00.000Z",
          level: "info",
          service: "auth",
          message: "ordinary log",
          attributes: { retries: false },
        },
      ],
    },
  });
  expect(ingest.statusCode).toBe(200);
  expect(json<{ accepted: number; rejected: { index: number; reason: string }[] }>(ingest)).toEqual(
    {
      accepted: 3,
      rejected: [{ index: 1, reason: "invalid level: 'critical'" }],
    },
  );

  const matched = await app.inject({
    method: "GET",
    url: "/logs?service=checkout&attr.retries=3&q=100%25_Ready&unknown_generator_parameter=ignored",
    headers: { authorization: "Bearer ignored" },
  });
  expect(matched.statusCode).toBe(200);
  const matchedBody = json<LogResponse>(matched);
  expect(matchedBody.logs).toHaveLength(2);
  expect(matchedBody.logs.map((log) => log.message).sort()).toEqual([
    "100%_Ready",
    "100%_Ready second",
  ]);
  expect(matchedBody.logs.some((log) => typeof log.attributes.retries === "number")).toBe(true);
  expect(matchedBody.logs.some((log) => typeof log.attributes.retries === "string")).toBe(true);

  const firstPage = await app.inject({ method: "GET", url: "/logs?service=checkout&limit=1" });
  expect(firstPage.statusCode).toBe(200);
  const firstPageBody = json<LogResponse>(firstPage);
  expect(firstPageBody.logs).toHaveLength(1);
  expect(firstPageBody.next_cursor).not.toBeNull();
  const secondPage = await app.inject({
    method: "GET",
    url: `/logs?service=checkout&limit=1&cursor=${encodeURIComponent(firstPageBody.next_cursor ?? "")}`,
  });
  expect(secondPage.statusCode).toBe(200);
  const secondPageBody = json<LogResponse>(secondPage);
  expect(secondPageBody.logs).toHaveLength(1);
  expect(secondPageBody.logs[0]?.id).not.toBe(firstPageBody.logs[0]?.id);
  expect(secondPageBody.next_cursor).toBeNull();

  const aggregate = await app.inject({
    method: "GET",
    url: "/logs/aggregate?since=2026-07-20T14%3A00%3A00.000Z&until=2026-07-20T14%3A01%3A00.000Z&bucket=1m&group_by=service",
  });
  expect(aggregate.statusCode).toBe(200);
  expect(json<AggregateResponse>(aggregate).buckets).toEqual([
    { start: timestamp, group: "checkout", count: 2 },
  ]);
});

// Explicit result types make each contract assertion document its expected wire shape.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function json<T>(response: { json(): unknown }): T {
  return response.json() as T;
}
