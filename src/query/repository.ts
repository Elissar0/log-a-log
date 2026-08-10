import type { Pool, QueryResultRow } from "pg";
import { buildPredicates } from "./builder";
import { encodeCursor } from "./cursor";
import type { AggregateResult, LogResult, ParsedAggregateQuery, ParsedLogQuery } from "./types";
import type { Attributes, LogLevel } from "../ingest/types";

interface LogRow extends QueryResultRow {
  readonly id: string;
  readonly timestamp: Date | string;
  readonly level: LogLevel;
  readonly service: string;
  readonly message: string;
  readonly attributes: Attributes;
}

interface AggregateRow extends QueryResultRow {
  readonly bucket_start: Date | string;
  readonly group_value: string | null;
  readonly count: string;
}

export interface LogPage {
  readonly logs: LogResult[];
  readonly nextCursor: string | null;
}

export interface LogQueryRepository {
  list(query: ParsedLogQuery): Promise<LogPage>;
  aggregate(query: ParsedAggregateQuery): Promise<AggregateResult[]>;
}

const BUCKET_SQL = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "1h": "1 hour",
  "1d": "1 day",
} as const;

const GROUP_SQL = {
  service: "service",
  level: "level",
} as const;

export class PgLogQueryRepository implements LogQueryRepository {
  public constructor(private readonly pool: Pick<Pool, "query">) {}

  public async list(query: ParsedLogQuery): Promise<LogPage> {
    const predicates = buildPredicates(query.filters, query.cursor);
    const limitParameter = `$${String(predicates.values.length + 1)}`;
    const result = await this.pool.query<LogRow>(
      `SELECT id, timestamp, level, service, message, attributes
       FROM logs
       ${predicates.sql}
       ORDER BY timestamp DESC, id DESC
       LIMIT ${limitParameter}`,
      [...predicates.values, query.limit + 1],
    );
    const hasMore = result.rows.length > query.limit;
    const visibleRows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
    const logs = visibleRows.map(mapLogRow);
    const last = logs.at(-1);
    const nextCursor =
      hasMore && last !== undefined
        ? encodeCursor({ timestamp: last.timestamp, id: last.id }, query.filterHash)
        : null;
    return { logs, nextCursor };
  }

  public async aggregate(query: ParsedAggregateQuery): Promise<AggregateResult[]> {
    const predicates = buildPredicates(query.filters);
    const interval = BUCKET_SQL[query.bucket];
    const groupExpression = query.groupBy === undefined ? "NULL::text" : GROUP_SQL[query.groupBy];
    const result = await this.pool.query<AggregateRow>(
      `SELECT
         date_bin('${interval}'::interval, timestamp, '1970-01-01T00:00:00Z'::timestamptz) AS bucket_start,
         ${groupExpression} AS group_value,
         COUNT(*) AS count
       FROM logs
       ${predicates.sql}
       GROUP BY 1, 2
       ORDER BY bucket_start ASC, group_value ASC NULLS FIRST`,
      predicates.values,
    );
    return result.rows.map((row) => ({
      start: isoTimestamp(row.bucket_start),
      group: row.group_value,
      count: safeCount(row.count),
    }));
  }
}

function mapLogRow(row: LogRow): LogResult {
  return {
    id: row.id,
    timestamp: isoTimestamp(row.timestamp),
    level: row.level,
    service: row.service,
    message: row.message,
    attributes: row.attributes,
  };
}

function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function safeCount(value: string): number {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error("database returned an invalid aggregate count");
  }
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("aggregate count exceeds the safe integer range");
  }
  return Number(parsed);
}
