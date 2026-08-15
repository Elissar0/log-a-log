import type { DashboardFilters, RangePreset, ThemeChoice } from "./types";

export const RANGE_OPTIONS: readonly { readonly value: RangePreset; readonly label: string }[] = [
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "custom", label: "Custom" },
];

export function nextTheme(theme: ThemeChoice): ThemeChoice {
  return theme === "system" ? "light" : theme === "light" ? "dark" : "system";
}

export function readTheme(): ThemeChoice {
  const stored = localStorage.getItem("logalog-theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatTimestamp(value: string, long = false): string {
  return new Intl.DateTimeFormat(
    undefined,
    long
      ? { dateStyle: "medium", timeStyle: "long" }
      : { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" },
  ).format(new Date(value));
}

export function formatUpdateTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function rangeDescription(filters: DashboardFilters): string {
  if (filters.range !== "custom") {
    return RANGE_OPTIONS.find((option) => option.value === filters.range)?.label ?? filters.range;
  }
  return `${formatTimestamp(filters.since)} – ${formatTimestamp(filters.until)}`;
}
