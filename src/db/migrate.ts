import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const MIGRATION_LOCK_NAMESPACE = 1_812_419_903;
const MIGRATION_LOCK_ID = 1_116_607_083;
const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(new URL("./migrations", import.meta.url));

interface AppliedMigration {
  readonly name: string;
  readonly checksum: string;
}

export async function runMigrations(
  pool: Pick<Pool, "connect">,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [
      MIGRATION_LOCK_NAMESPACE,
      MIGRATION_LOCK_ID,
    ]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((name) => /^\d+[_-].+\.sql$/.test(name))
      .sort();
    const result = await client.query<AppliedMigration>(
      "SELECT name, checksum FROM schema_migrations",
    );
    const applied = new Map(result.rows.map((row) => [row.name, row.checksum]));

    for (const name of files) {
      const sql = await readFile(`${migrationsDirectory}/${name}`, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previousChecksum = applied.get(name);
      if (previousChecksum !== undefined) {
        if (previousChecksum !== checksum) throw new Error(`applied migration changed: ${name}`);
        continue;
      }
      await applyMigration(client, name, checksum, sql);
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [
        MIGRATION_LOCK_NAMESPACE,
        MIGRATION_LOCK_ID,
      ]);
    } finally {
      client.release();
    }
  }
}

async function applyMigration(
  client: PoolClient,
  name: string,
  checksum: string,
  sql: string,
): Promise<void> {
  await client.query("BEGIN");
  try {
    // Migrations run before readiness and may legitimately exceed API query limits.
    await client.query("SET LOCAL statement_timeout = 0");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
      name,
      checksum,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
