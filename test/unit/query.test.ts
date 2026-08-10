import { describe, expect, test } from "bun:test";
import { buildPredicates } from "../../src/query/builder";
import { decodeCursor, encodeCursor, filterHash } from "../../src/query/cursor";
import { parseAggregateQuery, parseLogQuery, QueryValidationError } from "../../src/query/parser";
import { safeCount } from "../../src/query/repository";

describe("query parsing and SQL construction", () => {
  test("combines attribute filters, ignores unknowns, and rejects repeated scalars", () => {
    const parsed = parseLogQuery({
      service: "checkout",
      "attr.region": "eu",
      "attr.retries": "3",
      additive_generator_field: "ignored",
    });
    expect(parsed.filters.attributes).toEqual({ region: "eu", retries: "3" });
    expect(() => parseLogQuery({ level: ["info", "error"] })).toThrow(QueryValidationError);
    expect(() => parseLogQuery({ "attr.region": ["eu", "us"] })).toThrow(QueryValidationError);
  });

  test("binds all values and treats ILIKE wildcard characters literally", () => {
    const parsed = parseLogQuery({
      service: "x' OR true --",
      q: "50%_done\\ok",
      since: "2026-07-20T14:00:00Z",
      until: "2026-07-20T15:00:00Z",
      "attr.user": "' OR 1=1",
    });
    const built = buildPredicates(parsed.filters);
    expect(built.sql).not.toContain("x' OR true");
    expect(built.sql).toContain("attributes_text @>");
    expect(built.sql).toContain("ESCAPE '\\'");
    expect(built.values).toContain("%50\\%\\_done\\\\ok%");
  });

  test("binds cursors to canonical filters but not to the page limit", () => {
    const filters = parseLogQuery({ service: "api", limit: "10" }).filters;
    const hash = filterHash("logs", filters);
    const encoded = encodeCursor(
      {
        timestamp: "2026-07-20T14:00:00.000Z",
        id: "01800000-0000-7000-8000-000000000000",
      },
      hash,
    );
    expect(parseLogQuery({ service: "api", limit: "20", cursor: encoded }).cursor?.id).toBe(
      "01800000-0000-7000-8000-000000000000",
    );
    expect(() => decodeCursor(encoded, filterHash("logs", { service: "other", attributes: {} }))).toThrow();
  });

  test("requires bounded aggregate inputs and safely maps int64 counts", () => {
    const parsed = parseAggregateQuery({
      since: "2026-07-20T14:00:00Z",
      until: "2026-07-20T15:00:00Z",
      bucket: "5m",
      group_by: "service",
    });
    expect(parsed.bucket).toBe("5m");
    expect(parsed.groupBy).toBe("service");
    expect(safeCount("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => safeCount("9007199254740992")).toThrow();
    expect(() => parseAggregateQuery({ since: "2026-01-01T00:00:00Z", bucket: "1m" })).toThrow(
      QueryValidationError,
    );
  });
});
