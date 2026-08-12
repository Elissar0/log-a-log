param(
  [string]$Database = "logalog",
  [ValidateSet("page", "service-page", "attribute", "aggregate")][string]$Query = "aggregate"
)

$statements = @{
  page = "EXPLAIN (ANALYZE, BUFFERS) SELECT id, timestamp FROM logs WHERE timestamp >= now() - interval '1 hour' ORDER BY timestamp DESC, id DESC LIMIT 100;"
  'service-page' = "EXPLAIN (ANALYZE, BUFFERS) SELECT id, timestamp FROM logs WHERE service = 'checkout' AND timestamp >= now() - interval '1 hour' ORDER BY timestamp DESC, id DESC LIMIT 100;"
  attribute = "EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM logs WHERE attributes ? 'marker' AND attributes ->> 'marker' = 'example' LIMIT 1;"
  aggregate = "EXPLAIN (ANALYZE, BUFFERS) SELECT date_bin('1 minute', timestamp, '1970-01-01T00:00:00Z'::timestamptz), service, count(*) FROM logs WHERE timestamp >= now() - interval '1 hour' GROUP BY 1, 2 ORDER BY 1, 2;"
}
docker compose exec -T postgres psql -U logalog -d $Database -c $statements[$Query]
