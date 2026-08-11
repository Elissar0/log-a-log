import { describe, expect, test } from "bun:test";
import Fastify from "fastify";
import { loadConfig } from "../../src/config";
import type { WriteBatcher } from "../../src/ingest/batcher";
import { registerIngestRoute } from "../../src/routes/ingest";

const validPayload = {
  logs: [
    {
      timestamp: "2026-07-20T14:00:00.000Z",
      level: "info",
      service: "api",
      message: "ok",
    },
  ],
};

describe("ingestion request admission", () => {
  test("releases parsing slots while requests wait for a durable commit", async () => {
    const config = loadConfig({});
    let submitted = 0;
    let resolveCommit: (() => void) | undefined;
    const commit = new Promise<void>((resolve) => {
      resolveCommit = resolve;
    });
    const batcher = {
      submit: () => {
        submitted += 1;
        return commit;
      },
    } as unknown as WriteBatcher;
    const app = Fastify({ bodyLimit: config.bodyLimitBytes });
    registerIngestRoute(app, batcher, config);
    await app.ready();

    try {
      const firstEight = Array.from({ length: 8 }, () =>
        app.inject({ method: "POST", url: "/logs", payload: validPayload }),
      );
      await waitFor(() => submitted === 8);

      const ninth = app.inject({ method: "POST", url: "/logs", payload: validPayload });
      await waitFor(() => submitted === 9);

      resolveCommit?.();
      const responses = await Promise.all([...firstEight, ninth]);
      expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    } finally {
      resolveCommit?.();
      await app.close();
    }
  });

  test("releases parsing slots when malformed JSON never reaches the handler", async () => {
    const config = loadConfig({});
    const batcher = { submit: () => Promise.resolve() } as unknown as WriteBatcher;
    const app = Fastify({ bodyLimit: config.bodyLimitBytes });
    registerIngestRoute(app, batcher, config);
    await app.ready();

    try {
      for (let index = 0; index < 12; index += 1) {
        const malformed = await app.inject({
          method: "POST",
          url: "/logs",
          headers: { "content-type": "application/json" },
          payload: "{",
        });
        expect(malformed.statusCode).toBe(400);
      }

      const valid = await app.inject({ method: "POST", url: "/logs", payload: validPayload });
      expect(valid.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not reached before timeout");
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
}
