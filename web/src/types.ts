export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type GroupBy = "level" | "service";
export type BucketSize = "1m" | "5m" | "1h" | "1d";
export type RangePreset = "15m" | "1h" | "6h" | "24h" | "7d" | "30d" | "custom";

export interface AttributeFilter {
  readonly id: string;
  readonly key: string;
  readonly value: string;
}

export interface DashboardFilters {
  readonly range: RangePreset;
  readonly since: string;
  readonly until: string;
  readonly service: string;
  readonly level: LogLevel | "";
  readonly q: string;
  readonly attributes: readonly AttributeFilter[];
}

export interface DashboardState {
  readonly filters: DashboardFilters;
  readonly groupBy: GroupBy;
}

export interface ResolvedRange {
  readonly since: string;
  readonly until: string;
  readonly durationMs: number;
}

export interface LogEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly service: string;
  readonly message: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface LogPage {
  readonly logs: readonly LogEntry[];
  readonly nextCursor: string | null;
}

export interface AggregateBucket {
  readonly start: string;
  readonly group: string | null;
  readonly count: number;
}

export interface ChartSeries {
  readonly key: string;
  readonly label: string;
  readonly color: string;
}

export interface ChartDatum {
  readonly start: string;
  readonly values: Readonly<Record<string, number>>;
  readonly total: number;
}

export interface ChartModel {
  readonly series: readonly ChartSeries[];
  readonly data: readonly ChartDatum[];
}

export type ThemeChoice = "system" | "light" | "dark";
