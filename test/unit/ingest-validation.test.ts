import { describe, expect, test } from "bun:test";
import { EnvelopeValidationError, validateIngestBody } from "../../src/ingest/validation";

const now = new Date("2026-07-20T14:00:00.000Z");

describe("validateIngestBody", () => {
  test("partially accepts valid flat scalar logs and preserves their types", () => {
    const batch = validateIngestBody(
      {
        logs: [
          {
            timestamp: "2026-07-20T13:59:59Z",
            level: "info",
            service: "checkout",
            message: "paid",
            attributes: { retries: 3, enabled: true, region: "eu" },
          },
          {
            timestamp: "2026-07-20T13:59:59Z",
            level: "critical",
            service: "checkout",
            message: "bad",
          },
          {
            timestamp: "2026-07-20T13:59:59Z",
            level: "info",
            service: "checkout",
            message: "nested",
            attributes: { nested: { no: true } },
          },
        ],
      },
      2_000,
      now,
      () => "01800000-0000-7000-8000-000000000000",
    );

    expect(batch.logs).toHaveLength(1);
    expect(batch.logs[0]?.attributes).toEqual({ retries: 3, enabled: true, region: "eu" });
    expect(batch.logs[0]?.attributesText).toEqual({ retries: "3", enabled: "true", region: "eu" });
    expect(batch.rejected).toEqual([
      { index: 1, reason: "invalid level: 'critical'" },
      {
        index: 2,
        reason: "attributes must be a flat object with string, number, or boolean values",
      },
    ]);
  });

  test("enforces a strict instant and the five-minute future boundary", () => {
    const accepted = validateIngestBody(
      {
        logs: [
          {
            timestamp: "2026-07-20T14:05:00.000Z",
            level: "debug",
            service: "api",
            message: "boundary",
          },
          {
            timestamp: "2026-07-20 14:00:00Z",
            level: "debug",
            service: "api",
            message: "not ISO",
          },
          {
            timestamp: "2026-07-20T14:05:00.001Z",
            level: "debug",
            service: "api",
            message: "future",
          },
        ],
      },
      3,
      now,
    );

    expect(accepted.logs).toHaveLength(1);
    expect(accepted.rejected.map((rejection) => rejection.reason)).toEqual([
      "invalid timestamp: expected an ISO 8601 instant",
      "timestamp is more than 5 minutes in the future",
    ]);
  });

  test("rejects an invalid batch envelope", () => {
    expect(() => validateIngestBody({ logs: "not an array" }, 2_000, now)).toThrow(
      EnvelopeValidationError,
    );
  });
});
