import { TimeSeriesChart } from "../Chart";
import type { AggregateBucket, GroupBy } from "../types";
import { InlineError } from "./InlineError";

interface ChartPanelProps {
  readonly buckets: readonly AggregateBucket[];
  readonly error: string | null;
  readonly groupBy: GroupBy;
  readonly loading: boolean;
  readonly onGroupChange: (groupBy: GroupBy) => void;
  readonly onRetry: () => void;
}

export function ChartPanel({
  buckets,
  error,
  groupBy,
  loading,
  onGroupChange,
  onRetry,
}: ChartPanelProps): React.JSX.Element {
  return (
    <section className="card chart-card">
      <div className="card-header">
        <div>
          <h3>Volume over time</h3>
          <p>Stacked log counts across the selected window</p>
        </div>
        <div className="segment-control" aria-label="Chart grouping">
          <button
            type="button"
            aria-pressed={groupBy === "level"}
            className={groupBy === "level" ? "active" : ""}
            onClick={() => onGroupChange("level")}
          >
            Level
          </button>
          <button
            type="button"
            aria-pressed={groupBy === "service"}
            className={groupBy === "service" ? "active" : ""}
            onClick={() => onGroupChange("service")}
          >
            Service
          </button>
        </div>
      </div>
      {error === null ? null : <InlineError message={error} onRetry={onRetry} />}
      <TimeSeriesChart buckets={buckets} groupBy={groupBy} loading={loading} />
    </section>
  );
}
