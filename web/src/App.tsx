import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAggregate, fetchHealth, fetchLogs } from "./api";
import { ChartPanel } from "./components/ChartPanel";
import { FilterPanel } from "./components/FilterPanel";
import { RefreshIcon } from "./components/Icons";
import { LogDrawer } from "./components/LogDrawer";
import { LogStream } from "./components/LogStream";
import { MetricsGrid } from "./components/MetricsGrid";
import { Topbar } from "./components/Topbar";
import { errorMessage, formatUpdateTime, nextTheme, rangeDescription, readTheme } from "./display";
import {
  buildChartModel,
  defaultDashboardState,
  errorShare,
  readDashboardState,
  resolveRange,
  writeDashboardState,
} from "./model";
import type {
  AggregateBucket,
  DashboardFilters,
  DashboardState,
  GroupBy,
  LogEntry,
  ThemeChoice,
} from "./types";

interface SectionState<T> {
  readonly value: T;
  readonly loading: boolean;
  readonly error: string | null;
}

export function App(): React.JSX.Element {
  const initialState = useMemo(() => readDashboardState(window.location.search), []);
  const [applied, setApplied] = useState<DashboardState>(initialState);
  const [draft, setDraft] = useState<DashboardFilters>(initialState.filters);
  const [logs, setLogs] = useState<SectionState<readonly LogEntry[]>>({
    value: [],
    loading: true,
    error: null,
  });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [aggregate, setAggregate] = useState<SectionState<readonly AggregateBucket[]>>({
    value: [],
    loading: true,
    error: null,
  });
  const [levelAggregate, setLevelAggregate] = useState<readonly AggregateBucket[]>([]);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(() => readTheme());
  const requestRef = useRef<AbortController | null>(null);
  const queryAnchorRef = useRef<Date | null>(null);
  const initialQueryRef = useRef(false);

  const runQuery = useCallback(async (state: DashboardState): Promise<void> => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const queryNow = new Date();
    queryAnchorRef.current = queryNow;
    setLogs((current) => ({ ...current, loading: true, error: null }));
    setAggregate((current) => ({ ...current, loading: true, error: null }));
    setHealth("checking");

    const logPromise = fetchLogs(state, { signal: controller.signal, now: queryNow });
    const chartPromise = fetchAggregate(state, state.groupBy, {
      signal: controller.signal,
      now: queryNow,
    });
    const levelPromise =
      state.groupBy === "level"
        ? chartPromise
        : fetchAggregate(state, "level", { signal: controller.signal, now: queryNow });
    const [logResult, chartResult, levelResult, healthResult] = await Promise.allSettled([
      logPromise,
      chartPromise,
      levelPromise,
      fetchHealth(controller.signal),
    ]);
    if (controller.signal.aborted) return;

    if (logResult.status === "fulfilled") {
      setLogs({ value: logResult.value.logs, loading: false, error: null });
      setNextCursor(logResult.value.nextCursor);
    } else {
      setLogs((current) => ({ ...current, loading: false, error: errorMessage(logResult.reason) }));
    }
    if (chartResult.status === "fulfilled") {
      setAggregate({ value: chartResult.value, loading: false, error: null });
    } else {
      setAggregate((current) => ({
        ...current,
        loading: false,
        error: errorMessage(chartResult.reason),
      }));
    }
    if (levelResult.status === "fulfilled") setLevelAggregate(levelResult.value);
    setHealth(healthResult.status === "fulfilled" && healthResult.value ? "online" : "offline");
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    if (initialQueryRef.current) return;
    initialQueryRef.current = true;
    void runQuery(initialState);
    return () => requestRef.current?.abort();
  }, [initialState, runQuery]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (theme === "system") localStorage.removeItem("logalog-theme");
    else localStorage.setItem("logalog-theme", theme);
  }, [theme]);

  const chartModel = useMemo(
    () => buildChartModel(aggregate.value, applied.groupBy),
    [aggregate.value, applied.groupBy],
  );
  const totalLogs = chartModel.data.reduce((sum, datum) => sum + datum.total, 0);
  const peak = Math.max(0, ...chartModel.data.map((datum) => datum.total));
  const errors = errorShare(levelAggregate);
  const rangeLabel = rangeDescription(applied.filters);

  const applyState = (next: DashboardState): void => {
    try {
      resolveRange(next.filters);
      setFilterError(null);
    } catch (error) {
      setFilterError(errorMessage(error));
      return;
    }
    setApplied(next);
    setDraft(next.filters);
    const query = writeDashboardState(next);
    window.history.replaceState(null, "", query === "" ? "/" : `/?${query}`);
    void runQuery(next);
  };

  const loadMore = async (): Promise<void> => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchLogs(applied, {
        cursor: nextCursor,
        ...(queryAnchorRef.current === null ? {} : { now: queryAnchorRef.current }),
      });
      setLogs((current) => {
        const existing = new Set(current.value.map((log) => log.id));
        return {
          value: [...current.value, ...page.logs.filter((log) => !existing.has(log.id))],
          loading: false,
          error: null,
        };
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLogs((current) => ({ ...current, error: errorMessage(error) }));
    } finally {
      setLoadingMore(false);
    }
  };

  const switchGroup = (groupBy: GroupBy): void => {
    if (groupBy === applied.groupBy) return;
    const next = { filters: applied.filters, groupBy };
    setApplied(next);
    window.history.replaceState(null, "", `/?${writeDashboardState(next)}`);
    void runQuery(next);
  };

  return (
    <div className="app-shell">
      <Topbar health={health} theme={theme} onThemeChange={() => setTheme(nextTheme(theme))} />
      <div className="workspace">
        <FilterPanel
          draft={draft}
          error={filterError}
          onChange={setDraft}
          onApply={() => applyState({ filters: draft, groupBy: applied.groupBy })}
          onReset={() => applyState(defaultDashboardState())}
        />
        <main className="content">
          <section className="hero-row">
            <div>
              <span className="eyebrow">Observability overview</span>
              <h2>System activity</h2>
              <p>
                {rangeLabel} ·{" "}
                {lastUpdated === null ? "Loading data" : `Updated ${formatUpdateTime(lastUpdated)}`}
              </p>
            </div>
            <button
              className="refresh-button"
              type="button"
              onClick={() => void runQuery(applied)}
              disabled={logs.loading || aggregate.loading}
            >
              <RefreshIcon />
              {logs.loading || aggregate.loading ? "Refreshing…" : "Refresh"}
            </button>
          </section>
          <MetricsGrid
            totalLogs={totalLogs}
            peak={peak}
            errorShare={errors}
            loadedRows={logs.value.length}
            hasMoreRows={nextCursor !== null}
            rangeLabel={rangeLabel}
          />
          <ChartPanel
            buckets={aggregate.value}
            error={aggregate.error}
            groupBy={applied.groupBy}
            loading={aggregate.loading}
            onGroupChange={switchGroup}
            onRetry={() => void runQuery(applied)}
          />
          <LogStream
            error={logs.error}
            loading={logs.loading}
            loadingMore={loadingMore}
            logs={logs.value}
            nextCursor={nextCursor}
            onLoadMore={() => void loadMore()}
            onRetry={() => void runQuery(applied)}
            onSelect={setSelectedLog}
          />
        </main>
      </div>
      {selectedLog === null ? null : (
        <LogDrawer log={selectedLog} onClose={() => setSelectedLog(null)} />
      )}
    </div>
  );
}
