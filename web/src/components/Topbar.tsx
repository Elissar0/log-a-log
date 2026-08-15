import { ThemeIcon } from "./Icons";
import type { ThemeChoice } from "../types";

interface TopbarProps {
  readonly health: "checking" | "online" | "offline";
  readonly theme: ThemeChoice;
  readonly onThemeChange: () => void;
}

export function Topbar({ health, theme, onThemeChange }: TopbarProps): React.JSX.Element {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Log-a-Log home">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>Log-a-Log</span>
      </a>
      <div className="topbar-actions">
        <span className={`health-pill ${health}`}>
          <i />
          {health === "online"
            ? "Service online"
            : health === "offline"
              ? "Service unavailable"
              : "Checking service"}
        </span>
        <button
          className="icon-button"
          type="button"
          onClick={onThemeChange}
          aria-label={`Theme: ${theme}. Change theme.`}
          title={`Theme: ${theme}`}
        >
          <ThemeIcon theme={theme} />
        </button>
      </div>
    </header>
  );
}
