import { createHash } from "node:crypto";

export type RequestCategory = "main" | "summary" | "recall";
export type RequestOutcome = "ok" | "failed" | "cancelled";
/** Disjoint billing buckets. Adapters must subtract cache buckets from an inclusive
 * provider input count BEFORE passing inputTokens here. Missing != zero. */
export interface MeterUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheWriteInputTokens: number | null;
}
export type MeterPrices = { [K in keyof MeterUsage]: number | null }; // currency / million tokens
export interface MeterRequest {
  id: number;
  category: RequestCategory;
  /** Exact UTF-8 request body, measured at the transport boundary, not messages-only.
   * chars means JS UTF-16 code units (compatible with legacy assemblyChars). */
  bytes: number;
  chars: number;
  bodySha256: string;
  startedMs: number;
  elapsedMs: number | null;
  outcome: RequestOutcome | null;
  usage: MeterUsage;
  prices: MeterPrices;
  cost: number | null;
}
export interface MeterVerification {
  id: string;
  ok: boolean;
  elapsedMs: number | null;
}
const usageKeys = ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheWriteInputTokens"] as const;
function nonnegative(n: number): boolean { return Number.isFinite(n) && n >= 0; }
function normalize(values: Partial<MeterUsage> = {}): MeterUsage {
  const out = {} as MeterUsage;
  for (const key of usageKeys) {
    const n = values[key];
    if (n != null && !nonnegative(n)) throw new RangeError(`Invalid ${key}`);
    out[key] = n ?? null;
  }
  return out;
}
export function meteredCost(usage: MeterUsage, prices: MeterPrices): number | null {
  const u = normalize(usage), p = normalize(prices);
  // 未上报的缓存桶不按 $0 计价；但调用方没给缓存价格时，不应把 input/output 的成本也锁死。
  // 同样：整块 usage 未上报时不能记成 cost=0。
  if (!usageKeys.some((key) => u[key] !== null)) return null;
  if (!usageKeys.some((key) => p[key] !== null)) return null;
  let cost = 0;
  for (const key of usageKeys) {
    const n = u[key], price = p[key];
    if (n === null && price === null) continue;
    if (n === null || price === null) return null;
    cost += n * price / 1_000_000;
  }
  return Number.isFinite(cost) ? cost : null;
}
export interface MeterTotals {
  requests: number;
  bytes: number;
  chars: number;
  elapsedMs: number | null;
  usage: MeterUsage;
  cost: number | null;
}
function totals(requests: MeterRequest[]): MeterTotals {
  const sum = (values: (number | null)[]): number | null =>
    values.some((n) => n === null) ? null : values.reduce<number>((a, b) => a + b!, 0);
  const usage = {} as MeterUsage;
  for (const key of usageKeys) usage[key] = sum(requests.map((r) => r.usage[key]));
  return {
    requests: requests.length, bytes: requests.reduce((n, r) => n + r.bytes, 0),
    chars: requests.reduce((n, r) => n + r.chars, 0),
    elapsedMs: sum(requests.map((r) => r.elapsedMs)), usage,
    cost: sum(requests.map((r) => r.cost)),
  };
}
export interface MeterReport {
  version: 1;
  /** Span from construction to seal/snapshot, NOT sum of overlapping requests. */
  wallClockMs: number;
  requests: MeterRequest[];
  totals: MeterTotals;
  categories: Record<RequestCategory, MeterTotals>;
  verifications: MeterVerification[];
  verifyOutcome: "passed" | "failed" | "unknown";
}

/** In-memory opt-in collector. No global registration, network, event emission or payload storage. */
export class RequestMeter {
  private readonly started: number;
  private sealedAt: number | null = null;
  private readonly requests: MeterRequest[] = [];
  private readonly verifications = new Map<string, MeterVerification>();
  constructor(private readonly now: () => number = () => performance.now()) {
    this.started = this.clock();
  }
  private clock(): number {
    const time = this.now();
    if (!nonnegative(time)) throw new RangeError("Invalid clock");
    return time;
  }
  private open(): void {
    if (this.sealedAt !== null) throw new Error("Meter is sealed");
  }
  /** Call exactly once per actual transport attempt (including retries), not assembly. */
  beginRequest(category: RequestCategory, serializedBody: string, prices: Partial<MeterPrices> = {}): number {
    this.open();
    if (!["main", "summary", "recall"].includes(category)) throw new TypeError("Invalid category");
    const normalizedPrices = normalize(prices);
    const startedMs = this.clock() - this.started;
    if (startedMs < 0) throw new RangeError("Clock moved backwards");
    const id = this.requests.length + 1;
    this.requests.push({
      id, category, bytes: Buffer.byteLength(serializedBody, "utf8"), chars: serializedBody.length,
      bodySha256: createHash("sha256").update(serializedBody, "utf8").digest("hex"),
      startedMs, elapsedMs: null, outcome: null, usage: normalize(), prices: normalizedPrices, cost: null,
    });
    return id;
  }
  /** Usage is the FINAL cumulative provider usage, never a stream delta. Duplicate
   * finishes are rejected so replay/live echoes cannot inflate totals. */
  finishRequest(id: number, outcome: RequestOutcome, usage: Partial<MeterUsage> = {}): void {
    this.open();
    const request = this.requests[id - 1];
    if (!Number.isInteger(id) || !request) throw new RangeError("Unknown request");
    if (request.outcome !== null) throw new Error("Request already finished");
    if (!["ok", "failed", "cancelled"].includes(outcome)) throw new TypeError("Invalid outcome");
    const normalized = normalize(usage);
    const elapsedMs = this.clock() - this.started - request.startedMs;
    if (elapsedMs < 0) throw new RangeError("Clock moved backwards");
    Object.assign(request, { outcome, elapsedMs, usage: normalized, cost: meteredCost(normalized, request.prices) });
  }
  /** Use stable callId:attempt IDs; replaying an identical result is idempotent. */
  recordVerification(result: MeterVerification): void {
    this.open();
    if (!result.id || typeof result.ok !== "boolean" || (result.elapsedMs !== null && !nonnegative(result.elapsedMs))) {
      throw new TypeError("Invalid verification");
    }
    const old = this.verifications.get(result.id);
    if (old && (old.ok !== result.ok || old.elapsedMs !== result.elapsedMs)) throw new Error("Conflicting verification");
    this.verifications.set(result.id, { ...result });
  }
  seal(): MeterReport {
    if (this.sealedAt === null) this.sealedAt = this.clock();
    return this.snapshot();
  }
  snapshot(): MeterReport {
    const wallClockMs = (this.sealedAt ?? this.clock()) - this.started;
    if (wallClockMs < 0) throw new RangeError("Clock moved backwards");
    const requests = structuredClone(this.requests);
    const verifications = [...this.verifications.values()].map((v) => ({ ...v }));
    return {
      version: 1, wallClockMs, requests, totals: totals(requests),
      categories: {
        main: totals(requests.filter((r) => r.category === "main")),
        summary: totals(requests.filter((r) => r.category === "summary")),
        recall: totals(requests.filter((r) => r.category === "recall")),
      },
      verifications,
      verifyOutcome: verifications.length === 0 ? "unknown" : verifications.at(-1)!.ok ? "passed" : "failed",
    };
  }
  /** Seal first for byte-identical repeated exports under a live clock. */
  exportJSON(): string { return stableMeterJSON(this.seal()); }
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
/** Canonical object-key order; refuses lossy JSON (NaN, undefined, class instances).
 * Request bodies themselves are NEVER canonicalized before measuring. */
export function stableMeterJSON(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return Array.from(v, canonical);
    if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
    }
    throw new TypeError("Expected lossless JSON data");
  }
  return JSON.stringify(canonical(value));
}
function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}
export interface OfflineRunContext<T> {
  /** Fresh, deeply frozen copy of the SAME initial snapshot for every variant/rerun. */
  initial: Readonly<T>;
  seed: number;
  random: () => number;
  meter: RequestMeter;
  /** Explicit simulated time; offline timing is not a real-model latency claim. */
  advanceMs: (ms: number) => void;
}
export interface OfflineComparison {
  version: 1;
  mode: "offline";
  realModelBenefits: "unverified";
  initialSha256: string;
  seed: number;
  runs: { name: string; legacyMetrics: JsonValue; metering: MeterReport }[];
}
/** Callback is synchronous and local: supply frozen scripts/mock projections only.
 * This harness has no provider or transport dependency; it is NOT a callback sandbox. */
export function createOfflineComparison<T extends JsonValue>(initial: T, seed: number) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("Seed must be uint32");
  const serialized = stableMeterJSON(initial); // captured now, not when run is invoked
  const initialSha256 = createHash("sha256").update(serialized).digest("hex");
  return {
    run(variants: Record<string, (context: OfflineRunContext<T>) => JsonValue>): OfflineComparison {
      const runs = Object.keys(variants).sort().map((name) => {
        let time = 0, state = seed;
        const meter = new RequestMeter(() => time);
        const legacy = variants[name]({
          initial: freezeDeep(JSON.parse(serialized) as T), seed, meter,
          random: () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 0x100000000; },
          advanceMs: (ms) => {
            if (!nonnegative(ms) || !Number.isFinite(time + ms)) throw new RangeError("Invalid elapsed time");
            time += ms;
          },
        });
        return { name, legacyMetrics: JSON.parse(stableMeterJSON(legacy)) as JsonValue, metering: meter.seal() };
      });
      return { version: 1, mode: "offline", realModelBenefits: "unverified", initialSha256, seed, runs };
    },
  };
}
