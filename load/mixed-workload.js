import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const baseUrl = __ENV.BASE_URL || "http://localhost:8080";
const batchSize = Number(__ENV.BATCH_SIZE || 500);
const entriesPerSecond = Number(__ENV.TARGET_RATE || 15000);
const accepted = new Counter("entries_accepted");
const attempted = new Counter("entries_attempted");
const visibilitySeconds = new Trend("visibility_seconds", true);
const visibilityFailures = new Counter("visibility_deadline_failures");
const aggregateErrors = new Rate("aggregate_errors");

export const options = { scenarios: {
  ingest: { executor: "constant-arrival-rate", rate: Math.ceil(entriesPerSecond / batchSize), timeUnit: "1s", duration: __ENV.DURATION || "5m", preAllocatedVUs: 20, maxVUs: 200 },
  // This scenario is intentionally fixed at exactly one aggregation request per second.
  aggregate: { executor: "constant-arrival-rate", exec: "aggregate", rate: 1, timeUnit: "1s", duration: __ENV.DURATION || "5m", preAllocatedVUs: 1, maxVUs: 5 },
}, thresholds: { "http_req_failed{route:ingest}": ["rate==0"], "http_req_duration{route:aggregate}": ["p(95)<1000"], visibility_deadline_failures: ["count==0"] } };

function makeLog(i) { const marker = `${__VU}-${__ITER}-${i}-${Date.now()}`; return { timestamp: new Date().toISOString(), level: i % 20 ? "info" : "error", service: i % 3 ? "checkout" : "api", message: `mixed payment marker-${marker}`, attributes: { marker, region: i % 2 ? "eu" : "us", retries: i % 4, cached: i % 2 === 0 } }; }

export default function ingest() {
  const logs = Array.from({ length: batchSize }, (_, i) => makeLog(i)); attempted.add(logs.length);
  const response = http.post(`${baseUrl}/logs`, JSON.stringify({ logs }), { headers: { "Content-Type": "application/json", Authorization: "Bearer k6" }, tags: { route: "ingest" } });
  const ok = check(response, { "entire batch accepted": (r) => r.status === 200 && JSON.parse(r.body).accepted === logs.length });
  if (ok) accepted.add(logs.length);
  const marker = logs[0].attributes.marker; const started = Date.now();
  while (Date.now() - started < 20_000) {
    const found = http.get(`${baseUrl}/logs?attr.marker=${encodeURIComponent(marker)}&limit=1`, { headers: { Authorization: "Bearer k6" } });
    if (found.status === 200 && JSON.parse(found.body).logs.length === 1) { visibilitySeconds.add((Date.now() - started) / 1000); return; }
    sleep(0.25);
  }
  visibilityFailures.add(1);
}

export function aggregate() {
  const until = new Date(); const since = new Date(until.getTime() - 3_600_000);
  const response = http.get(`${baseUrl}/logs/aggregate?since=${encodeURIComponent(since.toISOString())}&until=${encodeURIComponent(until.toISOString())}&bucket=1m&group_by=service`, { headers: { Authorization: "Bearer k6" }, tags: { route: "aggregate" } });
  aggregateErrors.add(response.status !== 200);
}
