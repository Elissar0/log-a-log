import { createHash } from "node:crypto";
import type { CursorPosition, QueryFilters } from "./types";
import { parseInstant } from "./time";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CursorPayload {
  readonly v: 1;
  readonly ts: string;
  readonly id: string;
  readonly filter: string;
}

export class CursorValidationError extends Error {
  public constructor(message = "invalid cursor") {
    super(message);
    this.name = "CursorValidationError";
  }
}

export function filterHash(endpoint: "logs", filters: QueryFilters): string {
  const canonical = {
    endpoint,
    service: filters.service ?? null,
    level: filters.level ?? null,
    since: filters.since ?? null,
    until: filters.until ?? null,
    q: filters.q ?? null,
    attributes: Object.fromEntries(
      Object.entries(filters.attributes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function encodeCursor(position: CursorPosition, expectedFilterHash: string): string {
  const payload: CursorPayload = {
    v: 1,
    ts: position.timestamp,
    id: position.id,
    filter: expectedFilterHash,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeCursor(value: string, expectedFilterHash: string): CursorPosition {
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new CursorValidationError();
  }
  if (!isCursorPayload(payload) || payload.filter !== expectedFilterHash) {
    throw new CursorValidationError();
  }
  return { timestamp: payload.ts, id: payload.id };
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 4) return false;
  return (
    candidate.v === 1 &&
    typeof candidate.ts === "string" &&
    parseInstant(candidate.ts) !== null &&
    typeof candidate.id === "string" &&
    UUID_PATTERN.test(candidate.id) &&
    typeof candidate.filter === "string" &&
    /^[0-9a-f]{64}$/.test(candidate.filter)
  );
}
