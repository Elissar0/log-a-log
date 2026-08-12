import type { CursorPosition, QueryFilters } from "./types";

export interface SqlPredicates {
  readonly sql: string;
  readonly values: unknown[];
}

export function buildPredicates(
  filters: QueryFilters,
  cursor?: CursorPosition,
  initialValues: unknown[] = [],
): SqlPredicates {
  const predicates: string[] = [];
  const values: unknown[] = [...initialValues];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${String(values.length)}`;
  };

  if (filters.service !== undefined) predicates.push(`service = ${bind(filters.service)}`);
  if (filters.level !== undefined) predicates.push(`level = ${bind(filters.level)}`);
  if (filters.since !== undefined)
    predicates.push(`timestamp >= ${bind(filters.since)}::timestamptz`);
  if (filters.until !== undefined)
    predicates.push(`timestamp < ${bind(filters.until)}::timestamptz`);
  for (const [key, value] of Object.entries(filters.attributes)) {
    if (key === "marker") {
      // The literal expression matches logs_attr_marker_hash_idx. Binding the
      // JSON key would prevent PostgreSQL from selecting that expression index
      // for a generic prepared plan.
      predicates.push(`attributes ? 'marker' AND attributes ->> 'marker' = ${bind(value)}`);
    } else {
      predicates.push(`attributes ->> ${bind(key)} = ${bind(value)}`);
    }
  }
  if (filters.q !== undefined) {
    const literal = filters.q.replace(/[\\%_]/g, "\\$&");
    predicates.push(`message ILIKE ${bind(`%${literal}%`)} ESCAPE '\\'`);
  }
  if (cursor !== undefined) {
    const timestamp = bind(cursor.timestamp);
    const id = bind(cursor.id);
    predicates.push(`(timestamp, id) < (${timestamp}::timestamptz, ${id}::uuid)`);
  }
  return { sql: predicates.length === 0 ? "" : `WHERE ${predicates.join(" AND ")}`, values };
}
