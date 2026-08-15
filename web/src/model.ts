import {
  LOG_LEVELS,
  type AggregateBucket,
  type AttributeFilter,
  type BucketSize,
  type ChartModel,
  type ChartSeries,
  type DashboardFilters,
  type DashboardState,
  type GroupBy,
  type LogLevel,
  type RangePreset,
  type ResolvedRange,
} from "./types";

const PRESET_MS: Readonly<Record<Exclude<RangePreset, "custom">, number>> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "6h": 6 * 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
};
const PRESETS = new Set<RangePreset>([...Object.keys(PRESET_MS), "custom"] as RangePreset[]);
const GROUPS = new Set<GroupBy>(["level", "service"]);
const LEVEL_SET = new Set<LogLevel>(LOG_LEVELS);
const SERVICE_COLORS = ["#7c6ff2", "#00a8a8", "#e58b36", "#d75589", "#5d8ee8", "#8992a3"];
const LEVEL_COLORS: Readonly<Record<LogLevel, string>> = {
  debug: "#8992a3",
  info: "#5d8ee8",
  warn: "#e8a23a",
  error: "#e45b68",
};

export function defaultDashboardState(now = new Date()): DashboardState {
  return {
    filters: {
      range: "1h",
      since: new Date(now.getTime() - PRESET_MS["1h"]).toISOString(),
      until: now.toISOString(),
      service: "",
      level: "",
      q: "",
      attributes: [],
    },
    groupBy: "level",
  };
}

export function readDashboardState(search: string, now = new Date()): DashboardState {
  const defaults = defaultDashboardState(now);
  const params = new URLSearchParams(search);
  const rangeRaw = params.get("range");
  const range =
    rangeRaw !== null && PRESETS.has(rangeRaw as RangePreset)
      ? (rangeRaw as RangePreset)
      : defaults.filters.range;
  const groupRaw = params.get("group_by");
  const groupBy =
    groupRaw !== null && GROUPS.has(groupRaw as GroupBy) ? (groupRaw as GroupBy) : defaults.groupBy;
  const levelRaw = params.get("level");
  const level =
    levelRaw !== null && LEVEL_SET.has(levelRaw as LogLevel) ? (levelRaw as LogLevel) : "";
  const since = validInstant(params.get("since")) ?? defaults.filters.since;
  const until = validInstant(params.get("until")) ?? defaults.filters.until;
  const attributes: AttributeFilter[] = [];
  let attributeIndex = 0;
  for (const [key, value] of params.entries()) {
    if (!key.startsWith("attr.") || key.length === 5) continue;
    attributes.push({ id: `url-${String(attributeIndex++)}`, key: key.slice(5), value });
  }
  return {
    filters: {
      range,
      since,
      until,
      service: params.get("service") ?? "",
      level,
      q: params.get("q") ?? "",
      attributes,
    },
    groupBy,
  };
}

export function writeDashboardState(state: DashboardState): string {
  const params = new URLSearchParams();
  params.set("range", state.filters.range);
  params.set("group_by", state.groupBy);
  if (state.filters.range === "custom") {
    params.set("since", state.filters.since);
    params.set("until", state.filters.until);
  }
  appendIfPresent(params, "service", state.filters.service);
  appendIfPresent(params, "level", state.filters.level);
  appendIfPresent(params, "q", state.filters.q);
  for (const attribute of state.filters.attributes) {
    if (attribute.key.trim() !== "") params.set(`attr.${attribute.key.trim()}`, attribute.value);
  }
  return params.toString();
}

export function resolveRange(filters: DashboardFilters, now = new Date()): ResolvedRange {
  let sinceMs: number;
  let untilMs: number;
  if (filters.range === "custom") {
    sinceMs = Date.parse(filters.since);
    untilMs = Date.parse(filters.until);
  } else {
    untilMs = now.getTime();
    sinceMs = untilMs - PRESET_MS[filters.range];
  }
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
    throw new Error("Choose valid start and end times.");
  }
  if (untilMs <= sinceMs) throw new Error("The end time must be after the start time.");
  return {
    since: new Date(sinceMs).toISOString(),
    until: new Date(untilMs).toISOString(),
    durationMs: untilMs - sinceMs,
  };
}

export function bucketForDuration(durationMs: number): BucketSize {
  if (durationMs <= 2 * 60 * 60_000) return "1m";
  if (durationMs <= 12 * 60 * 60_000) return "5m";
  if (durationMs <= 7 * 24 * 60 * 60_000) return "1h";
  return "1d";
}

export function buildApiParams(
  filters: DashboardFilters,
  now = new Date(),
): { readonly params: URLSearchParams; readonly range: ResolvedRange } {
  const range = resolveRange(filters, now);
  const params = new URLSearchParams({ since: range.since, until: range.until });
  appendIfPresent(params, "service", filters.service);
  appendIfPresent(params, "level", filters.level);
  appendIfPresent(params, "q", filters.q);
  for (const attribute of filters.attributes) {
    const key = attribute.key.trim();
    if (key !== "") params.set(`attr.${key}`, attribute.value);
  }
  return { params, range };
}

export function buildChartModel(buckets: readonly AggregateBucket[], groupBy: GroupBy): ChartModel {
  const starts = [...new Set(buckets.map((bucket) => bucket.start))].sort();
  const series = groupBy === "level" ? levelSeries() : serviceSeries(buckets);
  const included = new Set(series.map((item) => item.key));
  const data = starts.map((start) => {
    const values: Record<string, number> = Object.fromEntries(series.map((item) => [item.key, 0]));
    for (const bucket of buckets) {
      if (bucket.start !== start) continue;
      const rawGroup = bucket.group ?? "all";
      const key = included.has(rawGroup) ? rawGroup : groupBy === "service" ? "Other" : rawGroup;
      if (included.has(key)) values[key] = (values[key] ?? 0) + bucket.count;
    }
    return {
      start,
      values,
      total: Object.values(values).reduce((sum, value) => sum + value, 0),
    };
  });
  return { series, data };
}

export function errorShare(buckets: readonly AggregateBucket[]): number | null {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total === 0) return null;
  const errors = buckets
    .filter((bucket) => bucket.group === "error")
    .reduce((sum, bucket) => sum + bucket.count, 0);
  return errors / total;
}

export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function localDateTimeToIso(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function levelSeries(): readonly ChartSeries[] {
  return LOG_LEVELS.map((level) => ({
    key: level,
    label: capitalize(level),
    color: LEVEL_COLORS[level],
  }));
}

function serviceSeries(buckets: readonly AggregateBucket[]): readonly ChartSeries[] {
  const totals = new Map<string, number>();
  for (const bucket of buckets) {
    if (bucket.group === null) continue;
    totals.set(bucket.group, (totals.get(bucket.group) ?? 0) + bucket.count);
  }
  const names = [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([name]) => name);
  const hasOther = totals.size > names.length;
  return [...names, ...(hasOther ? ["Other"] : [])].map((name, index) => ({
    key: name,
    label: name,
    color: SERVICE_COLORS[index % SERVICE_COLORS.length] ?? SERVICE_COLORS[0] ?? "#7c6ff2",
  }));
}

function validInstant(value: string | null): string | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function appendIfPresent(params: URLSearchParams, key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed !== "") params.set(key, trimmed);
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
