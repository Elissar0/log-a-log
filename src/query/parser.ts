import { decodeCursor, filterHash } from "./cursor";
import type {
  AggregateBucket,
  AggregateGroup,
  ParsedAggregateQuery,
  ParsedLogQuery,
  QueryFilters,
} from "./types";
import type { LogLevel } from "../ingest/types";
import { parseInstant } from "./time";

type RawQuery = Record<string, unknown>;
const LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);
const BUCKETS = new Set<AggregateBucket>(["1m", "5m", "1h", "1d"]);
const GROUPS = new Set<AggregateGroup>(["service", "level"]);

export class QueryValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "QueryValidationError";
  }
}

export function parseLogQuery(raw: RawQuery): ParsedLogQuery {
  const filters = parseFilters(raw);
  const limitRaw = scalar(raw, "limit");
  const limit = limitRaw === undefined ? 100 : parseLimit(limitRaw);
  const hash = filterHash("logs", filters);
  const cursorRaw = scalar(raw, "cursor");
  const cursor = cursorRaw === undefined ? undefined : decodeCursor(cursorRaw, hash);
  return cursor === undefined
    ? { filters, limit, filterHash: hash }
    : { filters, limit, filterHash: hash, cursor };
}

export function parseAggregateQuery(raw: RawQuery): ParsedAggregateQuery {
  if (raw.cursor !== undefined || raw.limit !== undefined) {
    throw new QueryValidationError("cursor and limit are not supported for aggregation");
  }
  const filters = parseFilters(raw);
  if (filters.since === undefined || filters.until === undefined) {
    throw new QueryValidationError("since and until are required");
  }
  const bucketRaw = scalar(raw, "bucket");
  if (bucketRaw === undefined || !BUCKETS.has(bucketRaw as AggregateBucket)) {
    throw new QueryValidationError("bucket must be one of: 1m, 5m, 1h, 1d");
  }
  const groupRaw = scalar(raw, "group_by");
  if (groupRaw !== undefined && !GROUPS.has(groupRaw as AggregateGroup)) {
    throw new QueryValidationError("group_by must be service or level");
  }
  const requiredFilters = { ...filters, since: filters.since, until: filters.until };
  return groupRaw === undefined
    ? { filters: requiredFilters, bucket: bucketRaw as AggregateBucket }
    : {
        filters: requiredFilters,
        bucket: bucketRaw as AggregateBucket,
        groupBy: groupRaw as AggregateGroup,
      };
}

function parseFilters(raw: RawQuery): QueryFilters {
  const service = scalar(raw, "service");
  const levelRaw = scalar(raw, "level");
  if (levelRaw !== undefined && !LEVELS.has(levelRaw as LogLevel)) {
    throw new QueryValidationError("invalid level");
  }
  const since = timestamp(raw, "since");
  const until = timestamp(raw, "until");
  if (since !== undefined && until !== undefined && Date.parse(until) < Date.parse(since)) {
    throw new QueryValidationError("until must not be before since");
  }
  const q = scalar(raw, "q");
  const attributes: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(raw)) {
    if (!name.startsWith("attr.")) continue;
    const key = name.slice(5);
    if (key.length === 0 || key.length > 256) throw new QueryValidationError("invalid attribute key");
    attributes[key] = scalarValue(rawValue, name);
  }
  return compactFilters({ service, level: levelRaw as LogLevel | undefined, since, until, q, attributes });
}

function compactFilters(input: {
  service: string | undefined;
  level: LogLevel | undefined;
  since: string | undefined;
  until: string | undefined;
  q: string | undefined;
  attributes: Record<string, string>;
}): QueryFilters {
  const result: { service?: string; level?: LogLevel; since?: string; until?: string; q?: string; attributes: Record<string, string> } = {
    attributes: input.attributes,
  };
  if (input.service !== undefined) result.service = input.service;
  if (input.level !== undefined) result.level = input.level;
  if (input.since !== undefined) result.since = input.since;
  if (input.until !== undefined) result.until = input.until;
  if (input.q !== undefined) result.q = input.q;
  return result;
}

function timestamp(raw: RawQuery, name: "since" | "until"): string | undefined {
  const value = scalar(raw, name);
  if (value === undefined) return undefined;
  const parsed = parseInstant(value);
  if (parsed === null) {
    throw new QueryValidationError(`${name} must be a valid ISO 8601 instant`);
  }
  return parsed;
}

function scalar(raw: RawQuery, name: string): string | undefined {
  const value = raw[name];
  return value === undefined ? undefined : scalarValue(value, name);
}

function scalarValue(value: unknown, name: string): string {
  if (Array.isArray(value)) throw new QueryValidationError(`${name} must not be repeated`);
  if (typeof value !== "string") throw new QueryValidationError(`${name} must be a string`);
  return value;
}

function parseLimit(value: string): number {
  if (!/^\d+$/.test(value)) throw new QueryValidationError("limit must be an integer");
  const limit = Number(value);
  if (limit < 1 || limit > 1_000) throw new QueryValidationError("limit must be between 1 and 1000");
  return limit;
}
