import type { FastifyBaseLogger } from "fastify";
import type { Pool, PoolClient, QueryResultRow } from "pg";

const RETENTION_LOCK_NAMESPACE = 1_812_419_903;
const RETENTION_LOCK_ID = 1_802_463_413;
const DELETE_EXPIRED = `
  WITH expired AS (
    SELECT timestamp, id
    FROM logs
    WHERE timestamp < $1::timestamptz
    ORDER BY timestamp, id
    LIMIT $2
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM logs l
  USING expired e
  WHERE l.timestamp = e.timestamp AND l.id = e.id
`;

interface LockRow extends QueryResultRow {
  readonly acquired: boolean;
}

export interface RetentionOptions {
  readonly retentionDays: number;
  readonly intervalMs: number;
  readonly batchSize: number;
}

export class RetentionWorker {
  private stopped = false;
  private loop: Promise<void> | undefined;
  private wakeSleep: (() => void) | undefined;

  public constructor(
    private readonly pool: Pick<Pool, "connect">,
    private readonly options: RetentionOptions,
    private readonly logger: Pick<FastifyBaseLogger, "info" | "warn">,
    private readonly now: () => number = Date.now,
  ) {}

  public start(): void {
    if (this.loop !== undefined) return;
    this.stopped = false;
    this.loop = this.run();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    this.wakeSleep?.();
    await this.loop;
  }

  private async run(): Promise<void> {
    while (!this.isStopped()) {
      let client: PoolClient | undefined;
      let destroyClient = false;
      try {
        client = await this.pool.connect();
        const lock = await client.query<LockRow>(
          "SELECT pg_try_advisory_lock($1, $2) AS acquired",
          [RETENTION_LOCK_NAMESPACE, RETENTION_LOCK_ID],
        );
        if (lock.rows[0]?.acquired !== true) {
          client.release();
          client = undefined;
          await this.sleep();
          continue;
        }

        while (!this.isStopped()) {
          const startedAt = this.now();
          const cutoff = new Date(
            startedAt - this.options.retentionDays * 86_400_000,
          ).toISOString();
          const deleted = await this.deletePass(client, cutoff);
          this.logger.info(
            { rowsDeleted: deleted, durationMs: this.now() - startedAt, cutoff },
            "retention pass completed",
          );
          await this.sleep();
        }
      } catch (error) {
        destroyClient = true;
        this.logger.warn({ err: error }, "retention pass failed; retrying later");
      } finally {
        if (client !== undefined) {
          if (!destroyClient) {
            await client
              .query("SELECT pg_advisory_unlock($1, $2)", [
                RETENTION_LOCK_NAMESPACE,
                RETENTION_LOCK_ID,
              ])
              .catch(() => undefined);
          }
          client.release(destroyClient);
        }
      }
      if (!this.isStopped()) await this.sleep();
    }
  }

  private async deletePass(client: PoolClient, cutoff: string): Promise<number> {
    let total = 0;
    while (!this.isStopped()) {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL lock_timeout = '500ms'");
        await client.query("SET LOCAL statement_timeout = '5s'");
        const result = await client.query(DELETE_EXPIRED, [cutoff, this.options.batchSize]);
        await client.query("COMMIT");
        const deleted = result.rowCount ?? 0;
        total += deleted;
        if (deleted < this.options.batchSize) break;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return total;
  }

  private sleep(): Promise<void> {
    if (this.isStopped()) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wakeSleep = undefined;
        resolve();
      }, this.options.intervalMs);
      this.wakeSleep = () => {
        clearTimeout(timer);
        this.wakeSleep = undefined;
        resolve();
      };
    });
  }

  private isStopped(): boolean {
    return this.stopped;
  }
}
