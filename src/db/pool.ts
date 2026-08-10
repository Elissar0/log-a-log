import { Pool } from "pg";
import type { AppConfig } from "../config";

export interface DatabasePools {
  readonly write: Pool;
  readonly query: Pool;
  readonly maintenance: Pool;
}

function pool(config: AppConfig, max: number, applicationName: string): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max,
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    idleTimeoutMillis: 30_000,
    statement_timeout: config.databaseStatementTimeoutMs,
    application_name: applicationName,
  });
}

export function createDatabasePools(config: AppConfig): DatabasePools {
  return {
    write: pool(config, config.writePoolSize, "log-a-log/write"),
    query: pool(config, config.queryPoolSize, "log-a-log/query"),
    maintenance: pool(config, 1, "log-a-log/maintenance"),
  };
}

export async function probeDatabase(poolToProbe: Pick<Pool, "query">): Promise<void> {
  await poolToProbe.query("SELECT 1");
}

export async function closeDatabasePools(pools: DatabasePools): Promise<void> {
  await Promise.allSettled([pools.write.end(), pools.query.end(), pools.maintenance.end()]);
}
