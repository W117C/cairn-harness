// 沙箱版 verify 执行器的接缝验收（上一轮把超时改成配置项后，"沙箱出口到底收不收这个超时"
// 只有换掉真 spawn 才测得到——宿主拒 apply 时 sandbox:check 走降级分支 B，端到端也不覆盖它）。
import { describe, expect, it } from "vitest";
import { defaultExec } from "../src/agent/verify";
import { verifyExec } from "../src/main/agent-runner";
import type { SandboxRunOptions, SandboxStatus } from "../src/main/sandbox";
import type { ToolResult } from "../src/tools";

const ON: SandboxStatus = { available: true };
const OFF: SandboxStatus = { available: false, reason: "sandbox_apply: Operation not permitted" };

interface Seen { command: string; opts: SandboxRunOptions }
function spy(result: ToolResult = { ok: true, output: "Tests 3 passed (3)" }): { calls: Seen[]; run: (c: string, o: SandboxRunOptions) => Promise<ToolResult> } {
  const calls: Seen[] = [];
  return { calls, run: async (command, opts) => { calls.push({ command, opts }); return result; } };
}

describe("verifyExec（沙箱是发货缺省路径）", () => {
  it("沙箱不可用 / 未知 ⇒ 直接就是 defaultExec（非沙箱宿主零行为，不多包一层）", () => {
    expect(verifyExec(null)).toBe(defaultExec);
    expect(verifyExec(OFF)).toBe(defaultExec);
  });

  it("超时透传给 runInSandbox；未给时不写这个键（沿用沙箱自己的缺省，不越权改写）", async () => {
    const s = spy();
    await verifyExec(ON, s.run)("cargo test", "/repo", 300_000);
    expect(s.calls[0]?.opts.timeoutMs).toBe(300_000);
    const s2 = spy();
    await verifyExec(ON, s2.run)("cargo test", "/repo");
    expect("timeoutMs" in (s2.calls[0]?.opts ?? {})).toBe(false);
  });

  it("pnpm test / pnpm run test 映射为直连 vitest；其它命令逐字不动", async () => {
    const s = spy();
    const exec = verifyExec(ON, s.run);
    await exec("pnpm test", "/repo");
    await exec("pnpm run test", "/repo");
    await exec("cargo test", "/repo");
    expect(s.calls[0]?.command).toContain("vitest");
    expect(s.calls[0]?.command).not.toContain("pnpm");
    expect(s.calls[1]?.command).toContain("vitest");
    expect(s.calls[2]?.command).toBe("cargo test");
  });

  it("结果里的 command 用模型下的原命令（事件流给人看的不是内部映射串）", async () => {
    const s = spy({ ok: false, output: "FAILED: 1 of 3" });
    const r = await verifyExec(ON, s.run)("pnpm test", "/repo");
    expect(r.command).toBe("pnpm test");
    expect(s.calls[0]?.command).not.toBe("pnpm test");
    expect(r.ok).toBe(false);
    expect(r.output).toContain("FAILED: 1 of 3");
  });
});
