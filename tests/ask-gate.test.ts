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
    await expect(promise).resolves.toMatchObject({ outcome: "approved", scope: "once" });
    expect(gate.pendingCount).toBe(0);
  });

  it("拒绝 → rejected", async () => {
    const askIds: string[] = [];
    const gate = new AskGate({ notify: (r) => askIds.push(r.askId) });
    const promise = gate.request("write_file", { path: "src/todo.ts" });
    expect(gate.decide(askIds[0] as string, false)).toBe(true);
    await expect(promise).resolves.toMatchObject({ outcome: "rejected", scope: "once" });
  });

  it("默认 60 秒无响应 → 按拒绝（假时钟，不真等）", async () => {
    vi.useFakeTimers();
    const outcomes: Array<{ id: string; outcome: string; reason: string }> = [];
    const gate = new AskGate({
      notifyOutcome: (id, outcome, reason) => outcomes.push({ id, outcome, reason }),
    });
    const promise = gate.request("run_shell", {});
    const expectation = expect(promise).resolves.toMatchObject({ outcome: "rejected" });
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
    const expectation = expect(promise).resolves.toMatchObject({ outcome: "rejected" });
    await vi.advanceTimersByTimeAsync(1000);
    await expectation;
  });

  it("M1c：决议携带 scope（批准 + session_kind → 回传同 scope）", async () => {
    const askIds: string[] = [];
    const gate = new AskGate({ notify: (r) => askIds.push(r.askId) });
    const promise = gate.request("run_shell", { command: "pnpm test" });
    expect(gate.decide(askIds[0] as string, true, "user", "session_kind")).toBe(true);
    await expect(promise).resolves.toMatchObject({ outcome: "approved", scope: "session_kind" });
  });

  it("M1c：请求携带 risk 上下文（审批卡必显）", async () => {
    const seen: Array<{ reason?: string; risk?: string }> = [];
    const gate = new AskGate({
      notify: (r) => {
        seen.push({ reason: r.reason, risk: r.risk });
        gate.decide(r.askId, false);
      },
    });
    await gate.request("run_shell", { command: "rm -rf /" }, {
      reason: "critical 任何档位强制审批",
      risk: "critical",
      riskReasons: ["rm 递归删除根路径"],
    });
    expect(seen[0]).toMatchObject({ reason: "critical 任何档位强制审批", risk: "critical" });
  });

  it("未知 / 已决议的 askId 决议为无操作（幂等）", async () => {
    const gate = new AskGate({ timeoutMs: 1000 });
    expect(gate.decide("no-such-id", true)).toBe(false);
    const askIds: string[] = [];
    const gate2 = new AskGate({ timeoutMs: 1000, notify: (r) => askIds.push(r.askId) });
    const promise = gate2.request("write_file", {});
    expect(gate2.decide(askIds[0] as string, true)).toBe(true);
    expect(gate2.decide(askIds[0] as string, false)).toBe(false); // 已决议，二次决议无效
    await expect(promise).resolves.toMatchObject({ outcome: "approved", scope: "once" });
  });

  // 审查待确认第 4 条（任务 4.3）：门侧的 ctx.signal 支持（D12）此前**没有任何断言钉住**，
  // 而调用侧也确实没传 => 取消 run 后审批卡驻留到 60s 超时。补两侧证据：abort 立即按拒绝
  // 收束且 pending 出表（这里把 timeoutMs 设成 60s，收束不了就是 vitest 超时红）。
  it("ctx.signal abort：pending 立即按拒绝收束并出表（不等超时）", async () => {
    const ac = new AbortController();
    const outcomes: string[] = [];
    const gate = new AskGate({
      timeoutMs: 60_000,
      notifyOutcome: (id, o, reason) => outcomes.push(id + ":" + o + ":" + reason),
    });
    const p = gate.request("run_shell", { command: "npm test" }, { signal: ac.signal });
    expect(gate.pendingCount).toBe(1);
    ac.abort();
    await expect(p).resolves.toMatchObject({ outcome: "rejected", reason: "user" });
    expect(gate.pendingCount).toBe(0);
    expect(outcomes).toEqual(["ask-1:rejected:user"]);
    // 已 abort 的信号不进等待：直接拒绝，不产生 pending 也不出卡
    const ac2 = new AbortController();
    ac2.abort();
    const gate2 = new AskGate({ timeoutMs: 60_000 });
    await expect(
      gate2.request("edit_file", {}, { signal: ac2.signal }),
    ).resolves.toMatchObject({ outcome: "rejected", reason: "user" });
    expect(gate2.pendingCount).toBe(0);
  });
});

  it("M4a unattended：无人值守立即拒绝（fail-closed 不等 60s），落流 reason=unattended", async () => {
    const outcomes: Array<{ askId: string; outcome: string; reason: string }> = [];
    const gate = new AskGate({
      unattended: true,
      notifyOutcome: (askId, outcome, reason) => outcomes.push({ askId, outcome, reason }),
    });
    const t0 = Date.now();
    const promise = gate.request("run_shell", { command: "rm -rf /" });
    const r = await promise;
    const elapsed = Date.now() - t0;
    // fail-closed 的核心：不等 60 秒，即刻拒绝
    expect(elapsed).toBeLessThan(5_000);
    expect(r).toEqual({ outcome: "rejected", scope: "once", reason: "unattended" });
    expect(outcomes).toEqual([{ askId: expect.any(String), outcome: "rejected", reason: "unattended" }]);
    // 不进 pending、不挂 timer（多次请求也不会堆积）
    expect(gate.pendingCount).toBe(0);
    await gate.request("write_file", { path: "x" });
    expect(gate.pendingCount).toBe(0);
  });

  it("unattended 下 notify 不被调用（无 UI 等待，直接拒绝）", async () => {
    const notifyCalls: string[] = [];
    const gate = new AskGate({
      unattended: true,
      notify: (r) => notifyCalls.push(r.askId),
    });
    await gate.request("run_shell", { command: "ls" });
    expect(notifyCalls).toEqual([]);
  });
