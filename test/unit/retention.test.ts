import { expect, test } from "bun:test";
import type { Pool, PoolClient } from "pg";
import { RetentionWorker } from "../../src/retention/worker";

test("retention takes an advisory lock and deletes with SKIP LOCKED", async () => {
  const statements: string[] = [];
  let releasePass: (() => void) | undefined;
  const passFinished = new Promise<void>((resolve) => {
    releasePass = resolve;
  });
  const client = {
    query: (sql: string) => {
      statements.push(sql);
      if (sql.includes("pg_try_advisory_lock")) {
        return Promise.resolve({ rows: [{ acquired: true }], rowCount: 1 });
      }
      if (sql === "COMMIT") releasePass?.();
      if (sql.includes("DELETE FROM logs")) return Promise.resolve({ rows: [], rowCount: 0 });
      return Promise.resolve({ rows: [], rowCount: null });
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = { connect: () => Promise.resolve(client) } as Pick<Pool, "connect">;
  const logger = { info: () => undefined, warn: () => undefined };
  const worker = new RetentionWorker(
    pool,
    { retentionDays: 30, intervalMs: 60_000, batchSize: 2_000 },
    logger,
    () => Date.parse("2026-07-20T00:00:00Z"),
  );

  worker.start();
  await passFinished;
  await worker.stop();
  expect(statements.some((sql) => sql.includes("pg_try_advisory_lock"))).toBe(true);
  expect(statements.some((sql) => sql.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
  expect(statements).toContain("SET LOCAL lock_timeout = '500ms'");
});
