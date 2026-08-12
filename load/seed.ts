/** Deterministically load the public API. Defaults to ~1M logs over 30 days. */
const baseUrl = (process.env.BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const count = int("COUNT", 1_000_000);
const batchSize = int("BATCH_SIZE", 1_000);
const concurrency = int("CONCURRENCY", 4);
const spreadDays = int("SPREAD_DAYS", 29);
// Keep the default dataset inside the retention window regardless of when the
// benchmark is run. END_AT remains available for reproducible historical runs.
const end = new Date(process.env.END_AT ?? new Date(Date.now() - 60 * 60_000).toISOString()).getTime();
if (!Number.isFinite(end)) throw new Error("END_AT must be an ISO timestamp");

function int(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

let randomState = Number(process.env.SEED ?? 20260811) >>> 0;
const random = () => (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const choose = <T>(items: readonly T[]): T => {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("cannot choose from an empty list");
  return item;
};
const services = ["checkout", "api", "auth", "worker", "search"] as const;
const levels = ["debug", "info", "info", "info", "warn", "error"] as const;
const messages = [
  "request completed",
  "payment declined",
  "cache refresh complete",
  "session validated",
] as const;

function log(index: number) {
  return {
    timestamp: new Date(
      end - spreadDays * 86_400_000 + Math.floor((index / count) * spreadDays * 86_400_000),
    ).toISOString(),
    level: choose(levels),
    service: choose(services),
    message: `${choose(messages)} seed-${index}`,
    attributes: {
      region: choose(["eu", "us", "ap"]),
      retries: Math.floor(random() * 4),
      cached: random() > 0.25,
      user_id: String(Math.floor(random() * 100_000)),
    },
  };
}

let nextIndex = 0;
async function worker(): Promise<void> {
  for (;;) {
    const start = nextIndex;
    nextIndex += batchSize;
    if (start >= count) return;
    const length = Math.min(batchSize, count - start);
    const response = await fetch(`${baseUrl}/logs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer load-seed" },
      body: JSON.stringify({ logs: Array.from({ length }, (_, i) => log(start + i)) }),
    });
    const payload = (await response.json().catch(() => null)) as { accepted?: number } | null;
    if (!response.ok || payload?.accepted !== length)
      throw new Error(`batch ${start} failed (${response.status})`);
    if (start % (batchSize * 20) === 0)
      console.log(`seeded ${Math.min(start + length, count)}/${count}`);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`seed complete: ${count} logs`);
