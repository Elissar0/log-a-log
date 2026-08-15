import { describe, expect, test } from "bun:test";
import {
  bucketForDuration,
  buildApiParams,
  buildChartModel,
  defaultDashboardState,
  readDashboardState,
  resolveRange,
  writeDashboardState,
} from "../src/model";
import type { AggregateBucket, DashboardState } from "../src/types";

const NOW = new Date("2026-08-15T12:00:00.000Z");

describe("dashboard model", () => {
  test("round-trips URL state with custom time and attribute filters", () => {
    const state: DashboardState = {
      filters: {
        ...defaultDashboardState(NOW).filters,
        range: "custom",
        since: "2026-08-15T10:00:00.000Z",
        until: "2026-08-15T11:00:00.000Z",
        service: "checkout",
        level: "error",
        q: "declined",
        attributes: [{ id: "one", key: "region", value: "eu-west" }],
      },
      groupBy: "service",
    };
    const encoded = writeDashboardState(state);
    const restored = readDashboardState(encoded, NOW);
    expect(restored).toEqual({
      ...state,
      filters: {
        ...state.filters,
        attributes: [{ id: "url-0", key: "region", value: "eu-west" }],
      },
    });
  });

  test("resolves rolling ranges once and selects bounded buckets", () => {
    const state = defaultDashboardState(NOW);
    expect(resolveRange(state.filters, NOW)).toEqual({
      since: "2026-08-15T11:00:00.000Z",
      until: "2026-08-15T12:00:00.000Z",
      durationMs: 3_600_000,
    });
    expect(bucketForDuration(2 * 3_600_000)).toBe("1m");
    expect(bucketForDuration(2 * 3_600_000 + 1)).toBe("5m");
    expect(bucketForDuration(12 * 3_600_000 + 1)).toBe("1h");
    expect(bucketForDuration(7 * 24 * 3_600_000 + 1)).toBe("1d");
  });

  test("constructs API filters without copying empty fields", () => {
    const filters = {
      ...defaultDashboardState(NOW).filters,
      service: "api",
      q: "timeout",
      attributes: [{ id: "one", key: "retries", value: "3" }],
    };
    const { params } = buildApiParams(filters, NOW);
    expect(params.get("service")).toBe("api");
    expect(params.get("q")).toBe("timeout");
    expect(params.get("attr.retries")).toBe("3");
    expect(params.has("level")).toBe(false);
  });

  test("keeps the five busiest services and combines the remainder", () => {
    const buckets: AggregateBucket[] = ["a", "b", "c", "d", "e", "f"].map((service, index) => ({
      start: "2026-08-15T11:00:00.000Z",
      group: service,
      count: 10 - index,
    }));
    const model = buildChartModel(buckets, "service");
    expect(model.series.map((series) => series.key)).toEqual(["a", "b", "c", "d", "e", "Other"]);
    expect(model.data[0]?.values.Other).toBe(5);
    expect(model.data[0]?.total).toBe(45);
  });
});
