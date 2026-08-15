import { formatTimestamp } from "../display";
import type { LogEntry } from "../types";
import { InlineError } from "./InlineError";

interface LogStreamProps {
  readonly error: string | null;
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly logs: readonly LogEntry[];
  readonly nextCursor: string | null;
  readonly onLoadMore: () => void;
  readonly onRetry: () => void;
  readonly onSelect: (log: LogEntry) => void;
}

export function LogStream({
  error,
  loading,
  loadingMore,
  logs,
  nextCursor,
  onLoadMore,
  onRetry,
  onSelect,
}: LogStreamProps): React.JSX.Element {
  return (
    <section className="card logs-card">
      <div className="card-header">
        <div>
          <h3>Log stream</h3>
          <p>Newest matching events first</p>
        </div>
        <span className="row-count">{logs.length.toLocaleString()} rows</span>
      </div>
      {error === null ? null : <InlineError message={error} onRetry={onRetry} />}
      <LogTable logs={logs} loading={loading} onSelect={onSelect} />
      {nextCursor !== null ? (
        <div className="load-more">
          <button type="button" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load older logs"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function LogTable({
  logs,
  loading,
  onSelect,
}: Pick<LogStreamProps, "logs" | "loading" | "onSelect">): React.JSX.Element {
  if (logs.length === 0 && !loading) {
    return (
      <div className="logs-empty">
        <strong>No logs found</strong>
        <span>Change the filters or widen the time range.</span>
      </div>
    );
  }
  if (logs.length === 0 && loading) {
    return (
      <div className="table-skeleton" aria-label="Loading logs">
        {[1, 2, 3, 4, 5].map((row) => (
          <i key={row} />
        ))}
      </div>
    );
  }
  return (
    <div className={`table-wrap${loading ? " is-loading" : ""}`}>
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Level</th>
            <th>Service</th>
            <th>Message</th>
            <th>Attributes</th>
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} onClick={() => onSelect(log)}>
              <td>
                <time dateTime={log.timestamp}>{formatTimestamp(log.timestamp)}</time>
              </td>
              <td>
                <span className={`level-badge ${log.level}`}>
                  <i />
                  {log.level}
                </span>
              </td>
              <td>
                <span className="service-name">{log.service}</span>
              </td>
              <td className="message-cell" title={log.message}>
                {log.message}
              </td>
              <td>
                <AttributePreview attributes={log.attributes} />
              </td>
              <td>
                <button
                  className="row-open"
                  type="button"
                  aria-label={`Open log ${log.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(log);
                  }}
                >
                  ›
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AttributePreview({
  attributes,
}: {
  readonly attributes: LogEntry["attributes"];
}): React.JSX.Element {
  const entries = Object.entries(attributes);
  if (entries.length === 0) return <span className="muted">—</span>;
  const first = entries[0];
  return (
    <div className="attribute-preview">
      {first === undefined ? null : (
        <code>
          {first[0]}={String(first[1])}
        </code>
      )}
      {entries.length > 1 ? <span>+{entries.length - 1}</span> : null}
    </div>
  );
}
