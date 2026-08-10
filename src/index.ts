import { buildApp } from "./app";
import { loadConfig } from "./config";
import { runMigrations } from "./db/migrate";
import { closeDatabasePools, createDatabasePools, probeDatabase } from "./db/pool";
import { WriteBatcher } from "./ingest/batcher";
import { PgLogWriteRepository } from "./ingest/repository";
import { PgLogQueryRepository } from "./query/repository";
import type { Readiness } from "./routes/health";

const config = loadConfig();
const pools = createDatabasePools(config);
const readiness: Readiness = { ready: false };
const repository = new PgLogWriteRepository(pools.write);
const queryRepository = new PgLogQueryRepository(pools.query);
const batcher = new WriteBatcher(repository, {
  maxQueuedEntries: config.maxQueuedEntries,
  maxQueuedBytes: config.maxQueuedBytes,
  flushEntries: config.flushEntries,
  flushBytes: config.flushBytes,
  flushDelayMs: config.flushDelayMs,
  immediateFlushEntries: config.immediateFlushEntries,
  maxTransactionEntries: config.maxLogsPerRequest,
  maxConcurrency: config.maxFlushConcurrency,
});
const app = buildApp({ config, pools, batcher, queryRepository, readiness });
let shuttingDown = false;

async function start(): Promise<void> {
  try {
    await runMigrations(pools.maintenance, process.env.MIGRATIONS_DIR);
    await probeDatabase(pools.query);
    await app.listen({ host: config.host, port: config.port });
    readiness.ready = true;
  } catch (error) {
    app.log.error({ err: error }, "startup failed");
    await closeDatabasePools(pools);
    process.exitCode = 1;
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  readiness.ready = false;
  app.log.info({ signal }, "shutdown started");

  const drain = async (): Promise<void> => {
    await app.close();
    await batcher.close();
    await closeDatabasePools(pools);
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      drain(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("shutdown deadline exceeded")), config.shutdownTimeoutMs);
      }),
    ]);
  } catch (error) {
    app.log.error({ err: error }, "shutdown did not drain cleanly");
    await closeDatabasePools(pools);
    process.exitCode = 1;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
await start();
