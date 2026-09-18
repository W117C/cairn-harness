import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  RequestMeter, createOfflineComparison, meteredCost, stableMeterJSON,
  type MeterUsage, type OfflineRunContext,
} from "../src/agent/metering";

const usage: MeterUsage = { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 30, cacheWriteInputTokens: 40 };
const prices = { inputTokens: 2, outputTokens: 4, cacheReadInputTokens: 0.2, cacheWriteInputTokens: 2.5 };
describe("request metering", () => {
  it("counts exact serialized UTF-8 bodies, categories, retries and concurrent wall time", () => {
    let now = 100;
    const meter = new RequestMeter(() => now);
    const body = JSON.stringify({ model: "mock", system: "中😀", tools: [{ name: "read" }], messages: ["a\n\"b"] });
    const a = meter.beginRequest("main", body, prices);
    now += 5;
    const b = meter.beginRequest("summary", "{}", prices);
    now += 10;
    meter.finishRequest(a, "failed", usage);
    meter.finishRequest(b, "ok", usage);
    const retry = meter.beginRequest("main", body, prices);
    const recall = meter.beginRequest("recall", '{"offset":0}', prices);
    now += 3;
    meter.finishRequest(retry, "ok", usage);
    meter.finishRequest(recall, "cancelled", usage);
    const report = meter.seal();
    expect(report.totals.requests).toBe(4);
    expect(report.categories.main.requests).toBe(2);
    expect(report.categories.summary.requests).toBe(1);
    expect(report.categories.recall.requests).toBe(1);
    expect(report.categories.main.bytes).toBe(Buffer.byteLength(body) * 2);
    expect(report.categories.main.chars).toBe(body.length * 2);
    expect(report.requests[0].bytes).toBeGreaterThan(report.requests[0].chars);
    expect(report.requests[0].bodySha256).toBe(createHash("sha256").update(body).digest("hex"));
    expect(report.wallClockMs).toBe(18);
    expect(report.totals.elapsedMs).toBe(31);
    expect(report.totals.usage.inputTokens).toBe(400);
    expect(report.totals.cost).toBeCloseTo(0.001544);
    expect(meter.exportJSON()).not.toContain("中😀");
  });
  it("keeps absent usage/cache/prices null and propagates partial unknowns", () => {
    const meter = new RequestMeter(() => 0);
    const a = meter.beginRequest("main", "{}", prices);
    meter.finishRequest(a, "ok", { inputTokens: 12, outputTokens: 2 });
    const b = meter.beginRequest("summary", "{}");
    meter.finishRequest(b, "ok", usage);
    const r = meter.seal();
    expect(r.requests[0].usage.cacheReadInputTokens).toBeNull();
    expect(r.requests[1].prices.inputTokens).toBeNull();
    expect(r.totals.usage.inputTokens).toBe(112);
    expect(r.totals.usage.cacheReadInputTokens).toBeNull();
    expect(r.totals.cost).toBeNull();
    expect(r.categories.recall.requests).toBe(0); // observed absence, not unknown usage
    expect(meteredCost({ ...usage, cacheWriteInputTokens: null }, prices)).toBeNull();
    expect(meteredCost({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0 }, prices)).toBe(0);
  });
  it("exports pending attempts honestly and seals repeatably without aliasing", () => {
    let now = 2;
    const meter = new RequestMeter(() => now);
    meter.beginRequest("main", "{}");
    now = 4;
    const json = meter.exportJSON();
    now = 999;
    expect(meter.exportJSON()).toBe(json);
    const report = meter.snapshot();
    expect(report.requests[0].outcome).toBeNull();
    expect(report.totals.elapsedMs).toBeNull();
    expect(report.totals.cost).toBeNull();
    report.requests[0].usage.inputTokens = 100;
    expect(meter.snapshot().requests[0].usage.inputTokens).toBeNull();
    expect(() => meter.beginRequest("main", "{}")).toThrow("sealed");
  });
  it("keeps verify attempts, idempotent echoes, and final recovery outcome", () => {
    const meter = new RequestMeter(() => 0);
    expect(meter.snapshot().verifyOutcome).toBe("unknown");
    const failed = { id: "v:1", ok: false, elapsedMs: 3 };
    meter.recordVerification(failed);
    meter.recordVerification(failed);
    expect(meter.snapshot().verifyOutcome).toBe("failed");
    meter.recordVerification({ id: "v:2", ok: true, elapsedMs: null });
    meter.recordVerification(failed); // old echo must not become latest verification
    expect(meter.snapshot().verifyOutcome).toBe("passed");
    expect(meter.snapshot().verifications).toHaveLength(2);
    expect(() => meter.recordVerification({ ...failed, ok: true })).toThrow("Conflicting");
  });
  it("rejects duplicate accounting, bad usage/prices and clocks without partial writes", () => {
    let now = 5;
    const meter = new RequestMeter(() => now);
    expect(() => meter.beginRequest("main", "{}", { inputTokens: NaN })).toThrow();
    const id = meter.beginRequest("main", "{}");
    expect(id).toBe(1);
    expect(() => meter.finishRequest(id, "ok", { inputTokens: -1 })).toThrow();
    expect(meter.snapshot().requests[0].outcome).toBeNull();
    now = 4;
    expect(() => meter.finishRequest(id, "ok")).toThrow("backwards");
    now = 6;
    meter.finishRequest(id, "ok");
    expect(() => meter.finishRequest(id, "ok")).toThrow("already finished");
    expect(() => meter.finishRequest(10, "ok")).toThrow("Unknown");
    expect(() => new RequestMeter(() => Infinity)).toThrow();
  });
});

describe("offline immutable comparison", () => {
  it("reruns variants from one frozen initial snapshot and seed, retains legacy metrics", () => {
    const initial = { messages: ["original 中😀"], legacy: { tokens: 123, turns: 2 } };
    const harness = createOfflineComparison(initial, 17);
    initial.messages.push("external mutation");
    type Input = typeof initial;
    const run = (short: boolean) => ({ initial: snapshot, random, meter, advanceMs }: OfflineRunContext<Input>) => {
      expect(snapshot.messages).toEqual(["original 中😀"]);
      expect(() => snapshot.messages.push("bad")).toThrow();
      const draw = random();
      const body = JSON.stringify({ messages: short ? ["receipt"] : snapshot.messages, draw });
      const id = meter.beginRequest("main", body);
      advanceMs(5);
      meter.finishRequest(id, "ok");
      meter.recordVerification({ id: "mock:1", ok: true, elapsedMs: 1 });
      return snapshot.legacy;
    };
    const variants = { optimized: run(true), legacy: run(false) };
    const a = harness.run(variants), b = harness.run(variants);
    expect(stableMeterJSON(a)).toBe(stableMeterJSON(b));
    expect(a.runs.map((r) => r.name)).toEqual(["legacy", "optimized"]);
    expect(a.runs[0].legacyMetrics).toEqual({ tokens: 123, turns: 2 });
    expect(a.runs[1].legacyMetrics).toEqual(a.runs[0].legacyMetrics);
    expect(a.runs[1].metering.totals.bytes).toBeLessThan(a.runs[0].metering.totals.bytes);
    expect(a.realModelBenefits).toBe("unverified");
    expect(a.runs[0].metering.totals.cost).toBeNull();
    a.runs[0].legacyMetrics = null;
    expect(harness.run(variants)).toEqual(b);
  });
  it("resets PRNG for each variant/rerun and canonicalizes object keys", () => {
    const h = createOfflineComparison({ b: 2, a: 1 }, 0);
    const callback = ({ random }: OfflineRunContext<{ b: number; a: number }>) => [random(), random()];
    const r = h.run({ b: callback, a: callback });
    expect(r.runs[0].legacyMetrics).toEqual(r.runs[1].legacyMetrics);
    expect(r.initialSha256).toBe(createOfflineComparison({ a: 1, b: 2 }, 0).run({}).initialSha256);
    expect(stableMeterJSON(r)).toBe(stableMeterJSON(h.run({ a: callback, b: callback })));
    expect(createOfflineComparison({}, 1).run({ x: ({ random }) => random() }).runs[0].legacyMetrics)
      .not.toEqual(createOfflineComparison({}, 2).run({ x: ({ random }) => random() }).runs[0].legacyMetrics);
  });
  it("rejects lossy snapshots, async callback data and invalid simulated timing", () => {
    expect(() => createOfflineComparison({ a: NaN }, 1)).toThrow();
    expect(() => createOfflineComparison({}, -1)).toThrow();
    expect(() => stableMeterJSON({ a: undefined })).toThrow();
    expect(() => stableMeterJSON(Promise.resolve(1))).toThrow();
    expect(() => createOfflineComparison({}, 1).run({ x: ({ advanceMs }) => { advanceMs(-1); return null; } })).toThrow();
  });
});
