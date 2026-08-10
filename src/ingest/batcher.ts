import type { LogWriteRepository } from "./repository";
import type { NormalizedLog } from "./types";

export interface WriteBatcherOptions {
  readonly maxQueuedEntries: number;
  readonly maxQueuedBytes: number;
  readonly flushEntries: number;
  readonly flushBytes: number;
  readonly flushDelayMs: number;
  readonly immediateFlushEntries: number;
  readonly maxTransactionEntries: number;
  readonly maxConcurrency: number;
}

interface PendingRequest {
  logs: readonly NormalizedLog[];
  readonly bytes: number;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

export class WriteQueueOverloadedError extends Error {
  public constructor() {
    super("ingestion queue is full");
    this.name = "WriteQueueOverloadedError";
  }
}

export class WriteBatcherClosedError extends Error {
  public constructor() {
    super("ingestion is shutting down");
    this.name = "WriteBatcherClosedError";
  }
}

export class WriteBatcher {
  private readonly queue: PendingRequest[] = [];
  private admittedEntries = 0;
  private admittedBytes = 0;
  private queuedEntries = 0;
  private queuedBytes = 0;
  private inFlight = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closing = false;
  private closePromise: Promise<void> | undefined;
  private resolveClose: (() => void) | undefined;

  public constructor(
    private readonly repository: LogWriteRepository,
    private readonly options: WriteBatcherOptions,
  ) {}

  public submit(logs: readonly NormalizedLog[], normalizedBytes: number): Promise<void> {
    if (logs.length === 0) return Promise.resolve();
    if (this.closing) return Promise.reject(new WriteBatcherClosedError());
    if (
      this.admittedEntries + logs.length > this.options.maxQueuedEntries ||
      this.admittedBytes + normalizedBytes > this.options.maxQueuedBytes
    ) {
      return Promise.reject(new WriteQueueOverloadedError());
    }

    this.admittedEntries += logs.length;
    this.admittedBytes += normalizedBytes;
    this.queuedEntries += logs.length;
    this.queuedBytes += normalizedBytes;

    const result = new Promise<void>((resolve, reject) => {
      this.queue.push({ logs, bytes: normalizedBytes, resolve, reject });
    });

    const immediate = logs.length >= this.options.immediateFlushEntries;
    this.pump(immediate);
    this.ensureTimer();
    return result;
  }

  public close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closing = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.closePromise = new Promise<void>((resolve) => {
      this.resolveClose = resolve;
    });
    this.pump(true);
    this.finishCloseIfIdle();
    return this.closePromise;
  }

  public get depth(): Readonly<{ entries: number; bytes: number; inFlight: number }> {
    return { entries: this.admittedEntries, bytes: this.admittedBytes, inFlight: this.inFlight };
  }

  private ensureTimer(): void {
    if (this.queue.length === 0 || this.timer !== undefined || this.closing) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pump(true);
      this.ensureTimer();
    }, this.options.flushDelayMs);
  }

  private pump(force: boolean): void {
    while (this.inFlight < this.options.maxConcurrency && this.queue.length > 0) {
      const thresholdReached =
        this.queuedEntries >= this.options.flushEntries || this.queuedBytes >= this.options.flushBytes;
      if (!force && !thresholdReached) break;
      const pending = this.takeTransaction();
      this.inFlight += 1;
      void this.flush(pending);
      force = this.closing;
    }
  }

  private takeTransaction(): PendingRequest[] {
    const transaction: PendingRequest[] = [];
    let entries = 0;
    let bytes = 0;
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (next === undefined) break;
      const exceedsEntries = entries + next.logs.length > this.options.maxTransactionEntries;
      const exceedsTarget =
        transaction.length > 0 &&
        (entries + next.logs.length > this.options.flushEntries ||
          bytes + next.bytes > this.options.flushBytes);
      if (exceedsEntries || exceedsTarget) break;
      this.queue.shift();
      transaction.push(next);
      entries += next.logs.length;
      bytes += next.bytes;
    }
    if (transaction.length === 0) {
      const next = this.queue.shift();
      if (next === undefined) throw new Error("write queue invariant violated");
      transaction.push(next);
      entries = next.logs.length;
      bytes = next.bytes;
    }
    this.queuedEntries -= entries;
    this.queuedBytes -= bytes;
    return transaction;
  }

  private async flush(pending: PendingRequest[]): Promise<void> {
    const logs = pending.flatMap((request) => request.logs);
    const entries = logs.length;
    const bytes = pending.reduce((total, request) => total + request.bytes, 0);
    try {
      await this.repository.insertCommitted(logs);
      for (const request of pending) request.resolve();
    } catch (error) {
      for (const request of pending) request.reject(error);
    } finally {
      for (const request of pending) request.logs = [];
      this.admittedEntries -= entries;
      this.admittedBytes -= bytes;
      this.inFlight -= 1;
      this.pump(this.closing);
      this.ensureTimer();
      this.finishCloseIfIdle();
    }
  }

  private finishCloseIfIdle(): void {
    if (this.closing && this.queue.length === 0 && this.inFlight === 0) this.resolveClose?.();
  }
}
