import type { Pool, QueryResultRow } from "pg";
import { buildPredicates } from "./builder";
import { encodeCursor } from "./cursor";
import type { AggregateResult, LogResult, ParsedAggregateQuery, ParsedLogQuery } from "./types";
import type { Attributes, LogLevel } from "../ingest/types";
import type { FringeRange, RecentAggregateCache } from "./recent-aggregate";

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
  public constructor(
    private readonly pool: Pick<Pool, "query">,
    private readonly aggregateCache?: RecentAggregateCache,
  ) {}

  public async list(query: ParsedLogQuery): Promise<LogPage> {
    const marker = query.filters.attributes.marker;
    if (marker !== undefined) return await this.listByMarker(query, marker);

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

  private async listByMarker(query: ParsedLogQuery, marker: string): Promise<LogPage> {
    const { marker: _marker, ...otherAttributes } = query.filters.attributes;
    const predicates = buildPredicates(
      { ...query.filters, attributes: otherAttributes },
      query.cursor,
      [marker],
    );
    const limitParameter = `$${String(predicates.values.length + 1)}`;
    const result = await this.pool.query<LogRow>(
      `WITH marker_match AS MATERIALIZED (
         SELECT id, timestamp, level, service, message, attributes
         FROM logs
         WHERE attributes ? 'marker' AND attributes ->> 'marker' = $1
       )
       SELECT id, timestamp, level, service, message, attributes
       FROM marker_match
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
    const cached = this.aggregateCache?.aggregate(query);
    if (cached !== undefined && cached !== null) {
      if (cached.fringes.length === 0) return cached.results;
      const fringeResults = await this.aggregateFringes(query, cached.fringes);
      return mergeAggregates(cached.results, fringeResults);
    }

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

  private async aggregateFringes(
    query: ParsedAggregateQuery,
    fringes: readonly FringeRange[],
  ): Promise<AggregateResult[]> {
    const { since: _since, until: _until, ...filters } = query.filters;
    const predicates = buildPredicates(filters);
    const rangeSql: string[] = [];
    for (const fringe of fringes) {
      predicates.values.push(fringe.since, fringe.until);
      const untilIndex = predicates.values.length;
      rangeSql.push(
        `(timestamp >= $${String(untilIndex - 1)}::timestamptz AND timestamp < $${String(untilIndex)}::timestamptz)`,
      );
    }
    const where = predicates.sql === "" ? "WHERE" : `${predicates.sql} AND`;
    const interval = BUCKET_SQL[query.bucket];
    const groupExpression = query.groupBy === undefined ? "NULL::text" : GROUP_SQL[query.groupBy];
    const result = await this.pool.query<AggregateRow>(
      `SELECT date_bin('${interval}'::interval, timestamp, '1970-01-01T00:00:00Z'::timestamptz) AS bucket_start,
              ${groupExpression} AS group_value, COUNT(*) AS count
       FROM logs
       ${where} (${rangeSql.join(" OR ")})
       GROUP BY 1, 2
       ORDER BY 1, 2 NULLS FIRST`,
      predicates.values,
    );
    return result.rows.map((row) => ({
      start: isoTimestamp(row.bucket_start),
      group: row.group_value,
      count: safeCount(row.count),
    }));
  }
}

function mergeAggregates(
  cached: readonly AggregateResult[],
  fringes: readonly AggregateResult[],
): AggregateResult[] {
  const merged = new Map<string, AggregateResult>();
  for (const result of [...cached, ...fringes]) {
    const key = `${result.start}\u0000${result.group ?? ""}`;
    const previous = merged.get(key);
    merged.set(key, previous === undefined ? result : { ...previous, count: previous.count + result.count });
  }
  return [...merged.values()].sort((left, right) => {
    const byStart = left.start.localeCompare(right.start);
    return byStart !== 0 ? byStart : (left.group ?? "").localeCompare(right.group ?? "");
  });
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
