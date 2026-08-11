export type LogLevel = "debug" | "info" | "warn" | "error";
export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue>;

export interface NormalizedLog {
  readonly id: string;
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly service: string;
  readonly message: string;
  readonly attributes: Attributes;
  readonly attributesJson: string;
}

export interface RejectedLog {
  readonly index: number;
  readonly reason: string;
}

export interface ValidatedBatch {
  readonly logs: NormalizedLog[];
  readonly rejected: RejectedLog[];
  readonly normalizedBytes: number;
}
