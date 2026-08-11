import type { Pool } from "pg";
import type { NormalizedLog } from "./types";

export interface LogWriteRepository {
  insertCommitted(logs: readonly NormalizedLog[]): Promise<void>;
}

const INSERT_LOGS = `
  INSERT INTO logs (id, timestamp, level, service, message, attributes)
  SELECT *
  FROM UNNEST(
    $1::uuid[],
    $2::timestamptz[],
    $3::text[],
    $4::text[],
    $5::text[],
    $6::jsonb[]
  )
`;

export class PgLogWriteRepository implements LogWriteRepository {
  public constructor(private readonly pool: Pick<Pool, "query">) {}

  public async insertCommitted(logs: readonly NormalizedLog[]): Promise<void> {
    if (logs.length === 0) return;
    // One INSERT is one implicit PostgreSQL transaction: all rows commit together,
    // and the write pool forces synchronous_commit=on at connection startup.
    await this.pool.query(INSERT_LOGS, [
      logs.map((log) => log.id),
      logs.map((log) => log.timestamp),
      logs.map((log) => log.level),
      logs.map((log) => log.service),
      logs.map((log) => log.message),
      logs.map((log) => log.attributesJson),
    ]);
  }
}
