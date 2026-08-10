import { describe, expect, test } from "bun:test";
import { WriteBatcher, WriteQueueOverloadedError } from "../../src/ingest/batcher";
import type { LogWriteRepository } from "../../src/ingest/repository";
import type { NormalizedLog } from "../../src/ingest/types";

const log: NormalizedLog = {
  id: "01800000-0000-7000-8000-000000000000",
  timestamp: "2026-07-20T14:00:00.000Z",
  level: "info",
  service: "api",
  message: "ok",
  attributes: {},
  attributesText: {},
};

const options = {
  maxQueuedEntries: 10,
  maxQueuedBytes: 1_000,
  flushEntries: 2,
  flushBytes: 1_000,
  flushDelayMs: 100,
  immediateFlushEntries: 2,
  maxTransactionEntries: 10,
  maxConcurrency: 1,
};

describe("WriteBatcher", () => {
  test("coalesces requests and resolves only after the repository commits", async () => {
    let resolveCommit: (() => void) | undefined;
    const inserted: NormalizedLog[][] = [];
    const repository: LogWriteRepository = {
      insertCommitted: async (logs) => {
        inserted.push([...logs]);
        await new Promise<void>((resolve) => {
          resolveCommit = resolve;
        });
      },
    };
    const batcher = new WriteBatcher(repository, options);
    const first = batcher.submit([log], 10);
    const second = batcher.submit([{ ...log, id: "01800000-0000-7000-8000-000000000001" }], 10);

    await Promise.resolve();
    expect(inserted).toHaveLength(1);
    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveCommit?.();
    expect(await Promise.all([first, second])).toEqual([undefined, undefined]);
    expect(inserted[0]).toHaveLength(2);
  });

  test("rejects admission beyond its bounded queue", async () => {
    const repository: LogWriteRepository = {
      insertCommitted: async () => new Promise<void>(() => 0),
    };
    const batcher = new WriteBatcher(repository, {
      ...options,
      maxQueuedEntries: 1,
      immediateFlushEntries: 1,
    });
    void batcher.submit([log], 1).catch(() => undefined);
    const rejection = batcher.submit([log], 1).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(await rejection).toBeInstanceOf(WriteQueueOverloadedError);
  });
});
