export interface AppConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly writePoolSize: number;
  readonly queryPoolSize: number;
  readonly maintenancePoolSize: 1;
  readonly databaseConnectTimeoutMs: number;
  readonly databaseStatementTimeoutMs: number;
  readonly bodyLimitBytes: number;
  readonly maxLogsPerRequest: number;
  readonly maxConcurrentIngestRequests: number;
  readonly maxQueuedEntries: number;
  readonly maxQueuedBytes: number;
  readonly flushEntries: number;
  readonly flushBytes: number;
  readonly flushDelayMs: number;
  readonly immediateFlushEntries: number;
  readonly maxFlushConcurrency: number;
  readonly shutdownTimeoutMs: number;
  readonly retentionDays: number;
  readonly retentionIntervalMs: number;
  readonly retentionBatchSize: number;
  readonly authEnabled: false;
}

type Environment = Record<string, string | undefined>;

function integer(
  env: Environment,
  name: string,
  fallback: number,
  options: { min: number; max: number },
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < options.min || value > options.max) {
    throw new Error(`${name} must be between ${String(options.min)} and ${String(options.max)}`);
  }
  return value;
}

function positiveNumber(env: Environment, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function disabledAuth(env: Environment): false {
  const value = env.AUTH_ENABLED?.toLowerCase() ?? "false";
  if (value !== "false" && value !== "0") {
    throw new Error("AUTH_ENABLED must be false; authentication is not implemented");
  }
  return false;
}

export function loadConfig(env: Environment = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/logs";
  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error();
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  return {
    host: env.HOST ?? "0.0.0.0",
    port: integer(env, "PORT", 8080, { min: 1, max: 65_535 }),
    databaseUrl,
    writePoolSize: integer(env, "WRITE_POOL_SIZE", 2, { min: 1, max: 2 }),
    queryPoolSize: integer(env, "QUERY_POOL_SIZE", 2, { min: 1, max: 4 }),
    maintenancePoolSize: 1,
    databaseConnectTimeoutMs: integer(env, "DATABASE_CONNECT_TIMEOUT_MS", 2_000, {
      min: 100,
      max: 60_000,
    }),
    databaseStatementTimeoutMs: integer(env, "DATABASE_STATEMENT_TIMEOUT_MS", 10_000, {
      min: 100,
      max: 120_000,
    }),
    bodyLimitBytes: integer(env, "BODY_LIMIT_BYTES", 2 * 1024 * 1024, {
      min: 1024,
      max: 2 * 1024 * 1024,
    }),
    maxLogsPerRequest: integer(env, "MAX_LOGS_PER_REQUEST", 2_000, {
      min: 1,
      max: 2_000,
    }),
    maxConcurrentIngestRequests: integer(env, "MAX_CONCURRENT_INGEST_REQUESTS", 8, {
      min: 1,
      max: 8,
    }),
    maxQueuedEntries: integer(env, "MAX_QUEUED_ENTRIES", 10_000, {
      min: 1,
      max: 10_000,
    }),
    maxQueuedBytes: integer(env, "MAX_QUEUED_BYTES", 8 * 1024 * 1024, {
      min: 1024,
      max: 8 * 1024 * 1024,
    }),
    flushEntries: integer(env, "FLUSH_ENTRIES", 1_000, { min: 1, max: 2_000 }),
    flushBytes: integer(env, "FLUSH_BYTES", 1024 * 1024, {
      min: 1024,
      max: 8 * 1024 * 1024,
    }),
    flushDelayMs: integer(env, "FLUSH_DELAY_MS", 10, { min: 1, max: 1_000 }),
    immediateFlushEntries: integer(env, "IMMEDIATE_FLUSH_ENTRIES", 500, {
      min: 1,
      max: 2_000,
    }),
    maxFlushConcurrency: integer(env, "MAX_FLUSH_CONCURRENCY", 2, { min: 1, max: 2 }),
    shutdownTimeoutMs: integer(env, "SHUTDOWN_TIMEOUT_MS", 10_000, {
      min: 100,
      max: 120_000,
    }),
    retentionDays: positiveNumber(env, "RETENTION_DAYS", 30),
    retentionIntervalMs: integer(env, "RETENTION_INTERVAL_MS", 60_000, {
      min: 1_000,
      max: 86_400_000,
    }),
    retentionBatchSize: integer(env, "RETENTION_BATCH_SIZE", 2_000, {
      min: 1,
      max: 10_000,
    }),
    authEnabled: disabledAuth(env),
  };
}
