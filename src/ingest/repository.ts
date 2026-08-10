import type { Pool, PoolClient } from "pg";
import type { NormalizedLog } from "./types";

export interface LogWriteRepository {
  insertCommitted(logs: readonly NormalizedLog[]): Promise<void>;
}

const INSERT_LOGS = `
  INSERT INTO logs (id, timestamp, level, service, message, attributes, attributes_text)
  SELECT *
  FROM UNNEST(
    $1::uuid[],
    $2::timestamptz[],
    $3::text[],
    $4::text[],
    $5::text[],
    $6::jsonb[],
    $7::jsonb[]
  )
`;

export class PgLogWriteRepository implements LogWriteRepository {
  public constructor(private readonly pool: Pick<Pool, "connect">) {}

  public async insertCommitted(logs: readonly NormalizedLog[]): Promise<void> {
    if (logs.length === 0) return;
    const client = await this.pool.connect();
    try {
      await transactionallyInsert(client, logs);
    } finally {
      client.release();
    }
  }
}

async function transactionallyInsert(
  client: PoolClient,
  logs: readonly NormalizedLog[],
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL synchronous_commit = on");
    await client.query(INSERT_LOGS, [
      logs.map((log) => log.id),
      logs.map((log) => log.timestamp),
      logs.map((log) => log.level),
      logs.map((log) => log.service),
      logs.map((log) => log.message),
      logs.map((log) => JSON.stringify(log.attributes)),
      logs.map((log) => JSON.stringify(log.attributesText)),
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
