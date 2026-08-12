import http from "k6/http";
import { Counter, Rate } from "k6/metrics";

const baseUrl = (__ENV.BASE_URL || "http://api:8080").replace(/\/$/, "");
const requestRate = Number(__ENV.REQUEST_RATE || 150);
const batchSize = Number(__ENV.BATCH_SIZE || 100);
const duration = __ENV.DURATION || "2m";

if (!Number.isSafeInteger(requestRate) || requestRate < 1) {
  throw new Error("REQUEST_RATE must be a positive integer");
}
if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
  throw new Error("BATCH_SIZE must be a positive integer");
}

const logsOffered = new Counter("logs_offered");
const logsAccepted = new Counter("logs_accepted");
const ingestRequestSuccess = new Rate("ingest_request_success");

export const options = {
  scenarios: {
    ingest: {
      executor: "constant-arrival-rate",
      rate: requestRate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 1000),
      maxVUs: Number(__ENV.MAX_VUS || 3000),
      gracefulStop: "30s",
    },
  },
  thresholds: {
    dropped_iterations: ["count==0"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function makeBatch() {
  const now = Date.now();
  const prefix = `${__VU}-${__ITER}-${now}`;
  return Array.from({ length: batchSize }, (_, index) => ({
    timestamp: new Date(now).toISOString(),
    level: index % 20 === 0 ? "error" : "info",
    service: index % 3 === 0 ? "api" : "checkout",
    message: `fixed-rate benchmark ${prefix}-${index}`,
    attributes: {
      marker: `${prefix}-${index}`,
      region: index % 2 === 0 ? "us" : "eu",
      retries: index % 4,
      cached: index % 2 === 0,
    },
  }));
}

export default function () {
  const logs = makeBatch();
  logsOffered.add(batchSize);

  const response = http.post(`${baseUrl}/logs`, JSON.stringify({ logs }), {
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fixed-rate-benchmark",
    },
    tags: { route: "ingest" },
    timeout: __ENV.REQUEST_TIMEOUT || "10s",
  });

  let accepted = 0;
  if (response.status === 200) {
    try {
      const parsed = JSON.parse(response.body);
      accepted = Number(parsed.accepted) || 0;
    } catch {
      accepted = 0;
    }
  }

  const success = response.status === 200 && accepted === batchSize;
  ingestRequestSuccess.add(success);
  if (accepted > 0) logsAccepted.add(accepted);
}

export function handleSummary(data) {
  const metric = (name, key) => data.metrics[name]?.values?.[key] ?? 0;
  const compact = {
    requests: metric("http_reqs", "count"),
    request_rate: metric("http_reqs", "rate"),
    successful_request_rate: metric("ingest_request_success", "rate"),
    logs_offered: metric("logs_offered", "count"),
    logs_accepted: metric("logs_accepted", "count"),
    dropped_iterations: metric("dropped_iterations", "count"),
    latency_p95_ms: metric("http_req_duration", "p(95)"),
    latency_p99_ms: metric("http_req_duration", "p(99)"),
  };
  return {
    "/results/summary.json": JSON.stringify(data, null, 2),
    stdout: `${JSON.stringify(compact, null, 2)}\n`,
  };
}
