import { useEffect, useRef } from "react";
import { formatTimestamp } from "../display";
import type { LogEntry } from "../types";

export function LogDrawer({
  log,
  onClose,
}: {
  readonly log: LogEntry;
  readonly onClose: () => void;
}): React.JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const listener = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || drawerRef.current === null) return;
      const focusable = [
        ...drawerRef.current.querySelectorAll<HTMLElement>(
          "button, [href], input, select, [tabindex]:not([tabindex='-1'])",
        ),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="drawer-layer">
      <button
        className="drawer-backdrop"
        type="button"
        aria-label="Close log details"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        className="log-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <div className="drawer-header">
          <div>
            <span className={`level-badge ${log.level}`}>
              <i />
              {log.level}
            </span>
            <h2 id="drawer-title">Log details</h2>
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close log details"
          >
            ×
          </button>
        </div>
        <div className="drawer-body">
          <Detail label="Timestamp" value={formatTimestamp(log.timestamp, true)} />
          <Detail label="Service" value={log.service} />
          <Detail label="ID" value={log.id} mono />
          <section>
            <span className="detail-label">Message</span>
            <p className="full-message">{log.message}</p>
          </section>
          <section>
            <div className="detail-title-row">
              <span className="detail-label">Attributes</span>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(JSON.stringify(log.attributes, null, 2))
                }
              >
                Copy JSON
              </button>
            </div>
            <pre>{JSON.stringify(log.attributes, null, 2)}</pre>
          </section>
        </div>
      </aside>
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): React.JSX.Element {
  return (
    <section>
      <span className="detail-label">{label}</span>
      <p className={mono ? "mono" : ""}>{value}</p>
    </section>
  );
}
