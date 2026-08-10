import type { Attributes, LogLevel } from "../ingest/types";

export interface QueryFilters {
  readonly service?: string;
  readonly level?: LogLevel;
  readonly since?: string;
  readonly until?: string;
  readonly q?: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface CursorPosition {
  readonly timestamp: string;
  readonly id: string;
}

export interface ParsedLogQuery {
  readonly filters: QueryFilters;
  readonly limit: number;
  readonly cursor?: CursorPosition;
  readonly filterHash: string;
}

export interface LogResult {
  readonly id: string;
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly service: string;
  readonly message: string;
  readonly attributes: Attributes;
}

export type AggregateBucket = "1m" | "5m" | "1h" | "1d";
export type AggregateGroup = "service" | "level";

export interface ParsedAggregateQuery {
  readonly filters: QueryFilters & { readonly since: string; readonly until: string };
  readonly bucket: AggregateBucket;
  readonly groupBy?: AggregateGroup;
}

export interface AggregateResult {
  readonly start: string;
  readonly group: string | null;
  readonly count: number;
}
