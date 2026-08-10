import { Type } from "@sinclair/typebox";
import Ajv from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import { v7 as uuidv7 } from "uuid";
import type {
  Attributes,
  LogLevel,
  NormalizedLog,
  RejectedLog,
  ValidatedBatch,
} from "./types";

const MAX_SERVICE_LENGTH = 256;
const MAX_MESSAGE_LENGTH = 16_384;
const MAX_ATTRIBUTE_KEY_LENGTH = 256;
const MAX_ATTRIBUTES_BYTES = 64 * 1024;
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

const ScalarAttributeSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);
const LogEntrySchema = Type.Object(
  {
    timestamp: Type.String(),
    level: Type.Union([
      Type.Literal("debug"),
      Type.Literal("info"),
      Type.Literal("warn"),
      Type.Literal("error"),
    ]),
    service: Type.String({ minLength: 1, maxLength: MAX_SERVICE_LENGTH }),
    message: Type.String({ minLength: 1, maxLength: MAX_MESSAGE_LENGTH }),
    attributes: Type.Optional(
      Type.Record(Type.String({ minLength: 1, maxLength: MAX_ATTRIBUTE_KEY_LENGTH }), ScalarAttributeSchema),
    ),
  },
  { additionalProperties: false },
);

const ajv = new Ajv({ allErrors: false, strict: true });
const validateEntry: ValidateFunction = ajv.compile(LogEntrySchema);

export class EnvelopeValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EnvelopeValidationError";
  }
}

interface CandidateEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly service: string;
  readonly message: string;
  readonly attributes?: Attributes;
}

export function validateIngestBody(
  body: unknown,
  maxLogs: number,
  now = new Date(),
  createId: () => string = uuidv7,
): ValidatedBatch {
  if (!isObject(body) || !Array.isArray(body.logs)) {
    throw new EnvelopeValidationError("body must be an object containing a logs array");
  }
  if (body.logs.length > maxLogs) {
    throw new EnvelopeValidationError(`logs must contain at most ${maxLogs} entries`);
  }

  const logs: NormalizedLog[] = [];
  const rejected: RejectedLog[] = [];
  let normalizedBytes = 0;
  const latestTimestamp = now.getTime() + 5 * 60_000;

  for (let index = 0; index < body.logs.length; index += 1) {
    const candidate = body.logs[index];
    if (!validateEntry(candidate)) {
      rejected.push({ index, reason: validationReason(validateEntry.errors?.[0], candidate) });
      continue;
    }

    const entry = candidate as CandidateEntry;
    const timestampMs = parseIsoInstant(entry.timestamp);
    if (timestampMs === null) {
      rejected.push({ index, reason: "invalid timestamp: expected an ISO 8601 instant" });
      continue;
    }
    if (timestampMs > latestTimestamp) {
      rejected.push({ index, reason: "timestamp is more than 5 minutes in the future" });
      continue;
    }

    const attributes = entry.attributes ?? {};
    const attributesJson = JSON.stringify(attributes);
    if (Buffer.byteLength(attributesJson) > MAX_ATTRIBUTES_BYTES) {
      rejected.push({ index, reason: `attributes exceed ${MAX_ATTRIBUTES_BYTES} bytes` });
      continue;
    }
    const attributesText: Record<string, string> = {};
    for (const key of Object.keys(attributes)) attributesText[key] = String(attributes[key]);

    const log: NormalizedLog = {
      id: createId(),
      timestamp: new Date(timestampMs).toISOString(),
      level: entry.level,
      service: entry.service,
      message: entry.message,
      attributes,
      attributesText,
    };
    logs.push(log);
    normalizedBytes += estimateNormalizedBytes(log, attributesJson);
  }

  return { logs, rejected, normalizedBytes };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIsoInstant(value: string): number | null {
  const match = ISO_INSTANT.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validationReason(error: ErrorObject | undefined, candidate: unknown): string {
  if (error === undefined) return "invalid log entry";
  if (error.keyword === "required") {
    const missing = (error.params as { missingProperty?: string }).missingProperty ?? "field";
    return `missing required field: ${missing}`;
  }
  if (error.instancePath === "/level" && isObject(candidate)) {
    return `invalid level: '${String(candidate.level)}'`;
  }
  const field = error.instancePath.slice(1) || "entry";
  if (error.keyword === "minLength") return `${field} must not be empty`;
  if (error.keyword === "maxLength") return `${field} is too long`;
  if (error.keyword === "additionalProperties") {
    const property = (error.params as { additionalProperty?: string }).additionalProperty;
    return property === undefined ? "entry contains an unknown field" : `unknown field: ${property}`;
  }
  if (error.instancePath.startsWith("/attributes")) {
    return "attributes must be a flat object with string, number, or boolean values";
  }
  return `${field} has an invalid type`;
}

function estimateNormalizedBytes(log: NormalizedLog, attributesJson: string): number {
  return (
    Buffer.byteLength(log.id) +
    Buffer.byteLength(log.timestamp) +
    Buffer.byteLength(log.level) +
    Buffer.byteLength(log.service) +
    Buffer.byteLength(log.message) +
    Buffer.byteLength(attributesJson) +
    Buffer.byteLength(JSON.stringify(log.attributesText))
  );
}
