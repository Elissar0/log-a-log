import { RANGE_OPTIONS } from "../display";
import { formatLocalDateTime, localDateTimeToIso } from "../model";
import {
  LOG_LEVELS,
  type AttributeFilter,
  type DashboardFilters,
  type RangePreset,
} from "../types";
import { ManualIcon, SearchIcon } from "./Icons";

interface FilterPanelProps {
  readonly draft: DashboardFilters;
  readonly error: string | null;
  readonly onChange: (filters: DashboardFilters) => void;
  readonly onApply: () => void;
  readonly onReset: () => void;
}

export function FilterPanel({
  draft,
  error,
  onChange,
  onApply,
  onReset,
}: FilterPanelProps): React.JSX.Element {
  return (
    <aside className="filter-panel" aria-label="Log filters">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Explore</span>
          <h1>Logs</h1>
        </div>
        <button className="text-button" type="button" onClick={onReset}>
          Reset
        </button>
      </div>
      <FilterForm draft={draft} onChange={onChange} onApply={onApply} error={error} />
      <div className="manual-note">
        <ManualIcon />
        <span>
          Manual refresh
          <br />
          <small>Data changes only when you ask.</small>
        </span>
      </div>
    </aside>
  );
}

function FilterForm({
  draft,
  onChange,
  onApply,
  error,
}: Omit<FilterPanelProps, "onReset">): React.JSX.Element {
  const update = <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]): void =>
    onChange({ ...draft, [key]: value });
  const addAttribute = (): void =>
    update("attributes", [...draft.attributes, { id: crypto.randomUUID(), key: "", value: "" }]);
  const updateAttribute = (id: string, patch: Partial<AttributeFilter>): void =>
    update(
      "attributes",
      draft.attributes.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <label className="field-label" htmlFor="range">
        Time range
      </label>
      <select
        id="range"
        value={draft.range}
        onChange={(event) => update("range", event.target.value as RangePreset)}
      >
        {RANGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {draft.range === "custom" ? (
        <div className="custom-range">
          <label>
            Start
            <input
              type="datetime-local"
              value={formatLocalDateTime(draft.since)}
              onChange={(event) => {
                const iso = localDateTimeToIso(event.target.value);
                if (iso !== null) update("since", iso);
              }}
            />
          </label>
          <label>
            End
            <input
              type="datetime-local"
              value={formatLocalDateTime(draft.until)}
              onChange={(event) => {
                const iso = localDateTimeToIso(event.target.value);
                if (iso !== null) update("until", iso);
              }}
            />
          </label>
        </div>
      ) : null}
      <label className="field-label" htmlFor="service">
        Service
      </label>
      <input
        id="service"
        value={draft.service}
        placeholder="e.g. checkout"
        onChange={(event) => update("service", event.target.value)}
      />
      <fieldset className="level-field">
        <legend>Level</legend>
        <div className="level-options">
          <button
            type="button"
            aria-pressed={draft.level === ""}
            className={draft.level === "" ? "active" : ""}
            onClick={() => update("level", "")}
          >
            All
          </button>
          {LOG_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={draft.level === level}
              className={`${level}${draft.level === level ? " active" : ""}`}
              onClick={() => update("level", level)}
            >
              {level}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="field-label" htmlFor="search">
        Message contains
      </label>
      <div className="input-with-icon">
        <SearchIcon />
        <input
          id="search"
          value={draft.q}
          placeholder="Search messages"
          onChange={(event) => update("q", event.target.value)}
        />
      </div>
      <div className="attribute-heading">
        <span className="field-label">Attributes</span>
        <button type="button" onClick={addAttribute}>
          + Add
        </button>
      </div>
      <div className="attribute-list">
        {draft.attributes.length === 0 ? (
          <p className="attribute-empty">No attribute filters</p>
        ) : (
          draft.attributes.map((attribute) => (
            <div className="attribute-row" key={attribute.id}>
              <input
                aria-label="Attribute key"
                placeholder="key"
                value={attribute.key}
                onChange={(event) => updateAttribute(attribute.id, { key: event.target.value })}
              />
              <input
                aria-label="Attribute value"
                placeholder="value"
                value={attribute.value}
                onChange={(event) => updateAttribute(attribute.id, { value: event.target.value })}
              />
              <button
                type="button"
                aria-label="Remove attribute"
                onClick={() =>
                  update(
                    "attributes",
                    draft.attributes.filter((item) => item.id !== attribute.id),
                  )
                }
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
      {error === null ? null : (
        <p className="filter-error" role="alert">
          {error}
        </p>
      )}
      <button className="apply-button" type="submit">
        Apply filters
      </button>
    </form>
  );
}
