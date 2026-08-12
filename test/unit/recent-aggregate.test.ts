import { describe, expect, test } from "bun:test";
import { RecentAggregateCache } from "../../src/query/recent-aggregate";
import type { NormalizedLog } from "../../src/ingest/types";
import type { ParsedAggregateQuery } from "../../src/query/types";

const now = Date.parse("2026-08-12T20:00:00.000Z");

function log(timestamp: string, service: string, level: NormalizedLog["level"]): NormalizedLog {
  return {
    id: crypto.randomUUID(),
    timestamp,
    service,
    level,
    message: "test",
    attributes: {},
    attributesJson: "{}",
  };
}

describe("RecentAggregateCache", () => {
  test("groups committed full seconds and exposes exact fringe ranges", async () => {
    const cache = new RecentAggregateCache();
    await cache.hydrate({ query: async () => ({ rows: [], rowCount: 0 }) } as never, now);
    cache.add(
      [
        log("2026-08-12T19:59:01.100Z", "api", "info"),
        log("2026-08-12T19:59:01.900Z", "api", "info"),
        log("2026-08-12T19:59:02.100Z", "checkout", "error"),
      ],
      now,
    );

    const query: ParsedAggregateQuery = {
      filters: {
        since: "2026-08-12T19:59:01.000Z",
        until: "2026-08-12T19:59:03.000Z",
        attributes: {},
      },
      bucket: "1m",
      groupBy: "service",
    };
    expect(cache.aggregate(query)).toEqual({
      results: [
        { start: "2026-08-12T19:59:00.000Z", group: "api", count: 2 },
        { start: "2026-08-12T19:59:00.000Z", group: "checkout", count: 1 },
      ],
      fringes: [],
    });

    const fringed = cache.aggregate({
      ...query,
      filters: {
        ...query.filters,
        since: "2026-08-12T19:59:01.250Z",
        until: "2026-08-12T19:59:02.750Z",
      },
    });
    expect(fringed?.fringes).toEqual([
      { since: "2026-08-12T19:59:01.250Z", until: "2026-08-12T19:59:02.000Z" },
      { since: "2026-08-12T19:59:02.000Z", until: "2026-08-12T19:59:02.750Z" },
    ]);
  });

  test("falls back for arbitrary attribute filters", async () => {
    const cache = new RecentAggregateCache();
    await cache.hydrate({ query: async () => ({ rows: [], rowCount: 0 }) } as never, now);
    expect(
      cache.aggregate({
        filters: {
          since: "2026-08-12T19:59:00.000Z",
          until: "2026-08-12T20:00:00.000Z",
          attributes: { region: "eu" },
        },
        bucket: "1m",
      }),
    ).toBeNull();
  });
});
