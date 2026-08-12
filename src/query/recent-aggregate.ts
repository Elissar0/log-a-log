import type { Pool, QueryResultRow } from "pg";
import type { NormalizedLog, LogLevel } from "../ingest/types";
import type { AggregateResult, ParsedAggregateQuery } from "./types";

const LEVEL_INDEX: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
const LEVELS = ["debug", "info", "warn", "error"] as const;
const BUCKET_MS = { "1m": 60_000, "5m": 300_000, "1h": 3_600_000, "1d": 86_400_000 } as const;

interface HydrationRow extends QueryResultRow {
  readonly second: string;
  readonly service: string;
  readonly level: LogLevel;
  readonly count: string;
}

export interface FringeRange {
  readonly since: string;
  readonly until: string;
}

export interface CachedAggregate {
  readonly results: AggregateResult[];
  readonly fringes: FringeRange[];
}

/** Exact, bounded counters for the recent aggregate window. */
export class RecentAggregateCache {
  private readonly seconds = new Map<number, Map<string, number[]>>();
  private coverageStartMs = Number.POSITIVE_INFINITY;
  private cellCount = 0;
  private enabled = true;

  public constructor(
    private readonly windowMs = 2 * 60 * 60_000,
    private readonly maxCells = 1_000_000,
  ) {}

  public async hydrate(pool: Pick<Pool, "query">, nowMs = Date.now()): Promise<void> {
    const startMs = Math.floor((nowMs - this.windowMs) / 1000) * 1000;
    const result = await pool.query<HydrationRow>(
      `SELECT floor(extract(epoch FROM timestamp))::bigint AS second,
              service, level, COUNT(*) AS count
       FROM logs
       WHERE timestamp >= $1::timestamptz
       GROUP BY 1, 2, 3`,
      [new Date(startMs).toISOString()],
    );
    this.seconds.clear();
    this.cellCount = 0;
    this.enabled = true;
    this.coverageStartMs = startMs;
    for (const row of result.rows) {
      this.increment(Number(row.second), row.service, row.level, Number(row.count));
    }
  }

  public add(logs: readonly NormalizedLog[], nowMs = Date.now()): void {
    if (!this.enabled) return;
    this.advanceWindow(nowMs);
    for (const log of logs) {
      const timestampMs = Date.parse(log.timestamp);
      if (timestampMs < this.coverageStartMs) continue;
      this.increment(Math.floor(timestampMs / 1000), log.service, log.level, 1);
      if (this.cellCount > this.maxCells) {
        this.enabled = false;
        this.seconds.clear();
        return;
      }
    }
  }

  public aggregate(query: ParsedAggregateQuery): CachedAggregate | null {
    if (
      !this.enabled ||
      query.filters.q !== undefined ||
      Object.keys(query.filters.attributes).length !== 0
    ) {
      return null;
    }
    const sinceMs = Date.parse(query.filters.since);
    const untilMs = Date.parse(query.filters.until);
    if (sinceMs < this.coverageStartMs) return null;

    const firstFullMs = Math.ceil(sinceMs / 1000) * 1000;
    const fullUntilMs = Math.floor(untilMs / 1000) * 1000;
    if (firstFullMs > fullUntilMs) return null;

    const counts = new Map<string, { start: string; group: string | null; count: number }>();
    const bucketMs = BUCKET_MS[query.bucket];
    for (let second = firstFullMs / 1000; second < fullUntilMs / 1000; second += 1) {
      const services = this.seconds.get(second);
      if (services === undefined) continue;
      for (const [service, levels] of services) {
        if (query.filters.service !== undefined && query.filters.service !== service) continue;
        for (let levelIndex = 0; levelIndex < LEVELS.length; levelIndex += 1) {
          const count = levels[levelIndex] ?? 0;
          if (count === 0) continue;
          const level = LEVELS[levelIndex];
          if (level === undefined) continue;
          if (query.filters.level !== undefined && query.filters.level !== level) continue;
          const start = new Date(Math.floor((second * 1000) / bucketMs) * bucketMs).toISOString();
          const group = query.groupBy === "service" ? service : query.groupBy === "level" ? level : null;
          const key = `${start}\u0000${group ?? ""}`;
          const existing = counts.get(key);
          if (existing === undefined) counts.set(key, { start, group, count });
          else existing.count += count;
        }
      }
    }

    const fringes: FringeRange[] = [];
    if (sinceMs < firstFullMs) {
      fringes.push({ since: query.filters.since, until: new Date(firstFullMs).toISOString() });
    }
    if (fullUntilMs < untilMs) {
      fringes.push({ since: new Date(fullUntilMs).toISOString(), until: query.filters.until });
    }
    const results = [...counts.values()].sort(compareAggregate);
    return { results, fringes };
  }

  private increment(second: number, service: string, level: LogLevel, count: number): void {
    let services = this.seconds.get(second);
    if (services === undefined) {
      services = new Map();
      this.seconds.set(second, services);
    }
    let levels = services.get(service);
    if (levels === undefined) {
      levels = [0, 0, 0, 0];
      services.set(service, levels);
    }
    const index = LEVEL_INDEX[level];
    if (levels[index] === 0) this.cellCount += 1;
    levels[index] = (levels[index] ?? 0) + count;
  }

  private advanceWindow(nowMs: number): void {
    const nextStartMs = Math.floor((nowMs - this.windowMs) / 1000) * 1000;
    if (nextStartMs <= this.coverageStartMs) return;
    for (const [second, services] of this.seconds) {
      if (second * 1000 >= nextStartMs) continue;
      for (const levels of services.values()) {
        for (const count of levels) if (count > 0) this.cellCount -= 1;
      }
      this.seconds.delete(second);
    }
    this.coverageStartMs = nextStartMs;
  }
}

function compareAggregate(
  left: { start: string; group: string | null },
  right: { start: string; group: string | null },
): number {
  const byStart = left.start.localeCompare(right.start);
  if (byStart !== 0) return byStart;
  return (left.group ?? "").localeCompare(right.group ?? "");
}
