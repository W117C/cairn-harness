// 批准门状态机：假时钟驱动超时，不真等 60 秒。
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskGate } from "../src/main/ask-gate";

afterEach(() => {
  vi.useRealTimers();
});

describe("AskGate", () => {
  it("批准 → approved（批准才放行）", async () => {
    const askIds: string[] = [];
    const gate = new AskGate({ notify: (r) => askIds.push(r.askId) });
    const promise = gate.request("run_shell", { command: "pnpm test" });
    expect(askIds.length).toBe(1);
    expect(gate.pendingCount).toBe(1);
    expect(gate.decide(askIds[0] as string, true)).toBe(true);
    await expect(promise).resolves.toBe("approved");
    expect(gate.pendingCount).toBe(0);
  });

  it("拒绝 → rejected", async () => {
    const askIds: string[] = [];
    const gate = new AskGate({ notify: (r) => askIds.push(r.askId) });
    const promise = gate.request("write_file", { path: "src/todo.ts" });
    expect(gate.decide(askIds[0] as string, false)).toBe(true);
    await expect(promise).resolves.toBe("rejected");
  });

  it("默认 60 秒无响应 → 按拒绝（假时钟，不真等）", async () => {
    vi.useFakeTimers();
    const outcomes: Array<{ id: string; outcome: string; reason: string }> = [];
    const gate = new AskGate({
      notifyOutcome: (id, outcome, reason) => outcomes.push({ id, outcome, reason }),
    });
    const promise = gate.request("run_shell", {});
    const expectation = expect(promise).resolves.toBe("rejected");
    await vi.advanceTimersByTimeAsync(60_000);
    await expectation;
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ outcome: "rejected", reason: "timeout" });
    expect(gate.pendingCount).toBe(0);
  });

  it("timeoutMs 可调（1s 超时同样走拒绝）", async () => {
    vi.useFakeTimers();
    const gate = new AskGate({ timeoutMs: 1000 });
    const promise = gate.request("write_file", {});
    const expectation = expect(promise).resolves.toBe("rejected");
    await vi.advanceTimersByTimeAsync(1000);
    await expectation;
  });

  it("未知 / 已决议的 askId 决议为无操作（幂等）", async () => {
    const gate = new AskGate({ timeoutMs: 1000 });
    expect(gate.decide("no-such-id", true)).toBe(false);
    const askIds: string[] = [];
    const gate2 = new AskGate({ timeoutMs: 1000, notify: (r) => askIds.push(r.askId) });
    const promise = gate2.request("write_file", {});
    expect(gate2.decide(askIds[0] as string, true)).toBe(true);
    expect(gate2.decide(askIds[0] as string, false)).toBe(false); // 已决议，二次决议无效
    await expect(promise).resolves.toBe("approved");
  });
});
