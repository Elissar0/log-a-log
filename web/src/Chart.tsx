import { useMemo, useState } from "react";
import { buildChartModel } from "./model";
import type { AggregateBucket, GroupBy } from "./types";

interface TimeSeriesChartProps {
  readonly buckets: readonly AggregateBucket[];
  readonly groupBy: GroupBy;
  readonly loading: boolean;
}

const WIDTH = 900;
const HEIGHT = 270;
const PADDING = { top: 16, right: 16, bottom: 42, left: 52 } as const;

export function TimeSeriesChart({
  buckets,
  groupBy,
  loading,
}: TimeSeriesChartProps): React.JSX.Element {
  const model = useMemo(() => buildChartModel(buckets, groupBy), [buckets, groupBy]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const max = Math.max(1, ...model.data.map((datum) => datum.total));
  const bandWidth = model.data.length === 0 ? plotWidth : plotWidth / model.data.length;
  const barWidth = Math.max(2, Math.min(28, bandWidth * 0.72));
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  if (model.data.length === 0 && !loading) {
    return (
      <div className="chart-empty">
        <span className="empty-signal" aria-hidden="true" />
        <strong>No activity in this window</strong>
        <span>Try a wider time range or clear a filter.</span>
      </div>
    );
  }

  return (
    <div className={`chart-shell${loading ? " is-loading" : ""}`}>
      <div className="chart-legend" aria-label="Chart legend">
        {model.series.map((series) => (
          <span key={series.key}>
            <i style={{ background: series.color }} />
            {series.label}
          </span>
        ))}
      </div>
      <div className="chart-canvas">
        <svg
          className="time-chart"
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          role="img"
          aria-label={`Log count over time, grouped by ${groupBy}`}
          onMouseLeave={() => setActiveIndex(null)}
        >
          {ticks.map((tick) => {
            const y = PADDING.top + plotHeight * (1 - tick);
            return (
              <g key={tick}>
                <line
                  className="chart-grid"
                  x1={PADDING.left}
                  x2={WIDTH - PADDING.right}
                  y1={y}
                  y2={y}
                />
                <text className="chart-axis-label" x={PADDING.left - 10} y={y + 4} textAnchor="end">
                  {compactNumber(Math.round(max * tick))}
                </text>
              </g>
            );
          })}
          {model.data.map((datum, index) => {
            const x = PADDING.left + index * bandWidth + (bandWidth - barWidth) / 2;
            let stacked = 0;
            return (
              <g
                key={datum.start}
                className="chart-bar-group"
                onMouseEnter={() => setActiveIndex(index)}
                tabIndex={0}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
                aria-label={`${formatChartTime(datum.start)}, ${String(datum.total)} logs`}
              >
                <rect
                  className="chart-hit-area"
                  x={PADDING.left + index * bandWidth}
                  y={PADDING.top}
                  width={bandWidth}
                  height={plotHeight}
                />
                {model.series.map((series) => {
                  const value = datum.values[series.key] ?? 0;
                  const height = (value / max) * plotHeight;
                  const y = PADDING.top + plotHeight - stacked - height;
                  stacked += height;
                  return value === 0 ? null : (
                    <rect
                      key={series.key}
                      x={x}
                      y={y}
                      width={barWidth}
                      height={height}
                      rx={2}
                      fill={series.color}
                    >
                      <title>{`${series.label}: ${value.toLocaleString()}`}</title>
                    </rect>
                  );
                })}
                {showXAxisLabel(index, model.data.length) ? (
                  <text
                    className="chart-axis-label"
                    x={x + barWidth / 2}
                    y={HEIGHT - 14}
                    textAnchor="middle"
                  >
                    {formatAxisTime(datum.start)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
        {activeIndex !== null && model.data[activeIndex] !== undefined ? (
          <ChartTooltip
            datum={model.data[activeIndex]}
            series={model.series}
            left={PADDING.left + activeIndex * bandWidth + bandWidth / 2}
          />
        ) : null}
      </div>
    </div>
  );
}

function ChartTooltip({
  datum,
  series,
  left,
}: {
  readonly datum: ReturnType<typeof buildChartModel>["data"][number];
  readonly series: ReturnType<typeof buildChartModel>["series"];
  readonly left: number;
}): React.JSX.Element {
  return (
    <div className="chart-tooltip" style={{ left: `${String((left / WIDTH) * 100)}%` }}>
      <strong>{formatChartTime(datum.start)}</strong>
      {series.map((item) => (
        <span key={item.key}>
          <i style={{ background: item.color }} />
          {item.label}
          <b>{(datum.values[item.key] ?? 0).toLocaleString()}</b>
        </span>
      ))}
    </div>
  );
}

function showXAxisLabel(index: number, length: number): boolean {
  if (length <= 6) return true;
  const interval = Math.ceil(length / 6);
  return index === 0 || index === length - 1 || index % interval === 0;
}

function formatAxisTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

function formatChartTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}
