import { buildApiParams, bucketForDuration } from "./model";
import {
  LOG_LEVELS,
  type AggregateBucket,
  type DashboardState,
  type LogEntry,
  type LogPage,
} from "./types";

export async function fetchHealth(signal?: AbortSignal): Promise<boolean> {
  const response = await fetch("/health", signal === undefined ? undefined : { signal });
  return response.ok;
}

export async function fetchLogs(
  state: DashboardState,
  options: { readonly cursor?: string; readonly signal?: AbortSignal; readonly now?: Date } = {},
): Promise<LogPage> {
  const { params } = buildApiParams(state.filters, options.now);
  params.set("limit", "100");
  if (options.cursor !== undefined) params.set("cursor", options.cursor);
  const response = await fetch(`/logs?${params.toString()}`, requestOptions(options.signal));
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(apiError(payload, "Logs could not be loaded."));
  if (!isRecord(payload) || !Array.isArray(payload.logs))
    throw new Error("The logs response was malformed.");
  const logs = payload.logs.map(parseLogEntry);
  const cursor = payload.next_cursor;
  if (cursor !== null && typeof cursor !== "string")
    throw new Error("The logs cursor was malformed.");
  return { logs, nextCursor: cursor };
}

export async function fetchAggregate(
  state: DashboardState,
  groupBy: "level" | "service",
  options: { readonly signal?: AbortSignal; readonly now?: Date } = {},
): Promise<readonly AggregateBucket[]> {
  const { params, range } = buildApiParams(state.filters, options.now);
  params.set("bucket", bucketForDuration(range.durationMs));
  params.set("group_by", groupBy);
  const response = await fetch(
    `/logs/aggregate?${params.toString()}`,
    requestOptions(options.signal),
  );
  const payload = await responsePayload(response);
  if (!response.ok) throw new Error(apiError(payload, "The aggregation could not be loaded."));
  if (!isRecord(payload) || !Array.isArray(payload.buckets)) {
    throw new Error("The aggregation response was malformed.");
  }
  return payload.buckets.map(parseAggregateBucket);
}

function parseLogEntry(value: unknown): LogEntry {
  if (!isRecord(value)) throw new Error("A log entry was malformed.");
  const { id, timestamp, level, service, message, attributes } = value;
  if (
    typeof id !== "string" ||
    typeof timestamp !== "string" ||
    typeof level !== "string" ||
    !LOG_LEVELS.includes(level as (typeof LOG_LEVELS)[number]) ||
    typeof service !== "string" ||
    typeof message !== "string" ||
    !isRecord(attributes)
  ) {
    throw new Error("A log entry was malformed.");
  }
  const parsedAttributes: Record<string, string | number | boolean> = {};
  for (const [key, attribute] of Object.entries(attributes)) {
    if (
      typeof attribute !== "string" &&
      typeof attribute !== "number" &&
      typeof attribute !== "boolean"
    ) {
      throw new Error("A log attribute was malformed.");
    }
    parsedAttributes[key] = attribute;
  }
  return {
    id,
    timestamp,
    level: level as LogEntry["level"],
    service,
    message,
    attributes: parsedAttributes,
  };
}

function parseAggregateBucket(value: unknown): AggregateBucket {
  if (!isRecord(value)) throw new Error("An aggregate bucket was malformed.");
  const { start, group, count } = value;
  if (
    typeof start !== "string" ||
    (group !== null && typeof group !== "string") ||
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < 0
  ) {
    throw new Error("An aggregate bucket was malformed.");
  }
  return { start, group, count };
}

async function responsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("The server returned an unreadable response.");
  }
}

function apiError(payload: unknown, fallback: string): string {
  return isRecord(payload) && typeof payload.error === "string" ? payload.error : fallback;
}

function requestOptions(signal: AbortSignal | undefined): RequestInit | undefined {
  return signal === undefined ? undefined : { signal };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
