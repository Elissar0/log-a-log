import { formatNumber } from "../display";

interface MetricsGridProps {
  readonly totalLogs: number;
  readonly peak: number;
  readonly errorShare: number | null;
  readonly loadedRows: number;
  readonly hasMoreRows: boolean;
  readonly rangeLabel: string;
}

export function MetricsGrid({
  totalLogs,
  peak,
  errorShare,
  loadedRows,
  hasMoreRows,
  rangeLabel,
}: MetricsGridProps): React.JSX.Element {
  return (
    <section className="metrics-grid" aria-label="Log metrics">
      <MetricCard
        label="Logs in view"
        value={formatNumber(totalLogs)}
        detail={rangeLabel}
        tone="violet"
      />
      <MetricCard
        label="Peak bucket"
        value={formatNumber(peak)}
        detail="Highest interval volume"
        tone="blue"
      />
      <MetricCard
        label="Error share"
        value={
          errorShare === null ? "—" : `${(errorShare * 100).toFixed(errorShare < 0.1 ? 1 : 0)}%`
        }
        detail="Of logs matching filters"
        tone="red"
      />
      <MetricCard
        label="Loaded rows"
        value={formatNumber(loadedRows)}
        detail={hasMoreRows ? "More results available" : "End of results"}
        tone="teal"
      />
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone: string;
}): React.JSX.Element {
  return (
    <article className={`metric-card ${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <i aria-hidden="true" />
    </article>
  );
}
