// 沙箱版 verify 执行器的接缝验收（上一轮把超时改成配置项后，"沙箱出口到底收不收这个超时"
// 只有换掉真 spawn 才测得到——宿主拒 apply 时 sandbox:check 走降级分支 B，端到端也不覆盖它）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultExec } from "../src/agent/verify";
import { MODEL_SHELL_TEST_ALIASES, SANDBOX_TEST_ALIASES, mapSandboxTestCommand, verifyExec } from "../src/main/agent-runner";
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

/** 三处消费者（worker 的 shell、验证门、模型那条 `run_shell`）原先各抄一行同族三元，
 *  且**宽度不同**（模型那条只认 `pnpm test`），三份里两份零观察者——只有 `verifyExec` 那条有测。
 *  收成一份之后，宽度差落成两个具名名单：差的那一条是"要不要替模型改写它自己下的命令"这个裁决，必须是点名的、不能是漂。 */
describe("沙箱 pnpm 映射收成一份", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/main/agent-runner.ts", import.meta.url)), "utf8");

  it("消费者不再各自内联那句三元：`? VITEST_DIRECT : command` 全文件只剩映射器里那一处", () => {
    expect(src.split("? VITEST_DIRECT : command").length - 1).toBe(1);
    expect(src.split("mapSandboxTestCommand(").length - 1).toBe(4); // 定义 1 ＋ 三处调用
  });

  it("窄名单逐字钉住，且与全表的双向差集都要点名（加一条进窄表＝绕开裁决给模型改命令）", () => {
    expect(MODEL_SHELL_TEST_ALIASES).toEqual(["pnpm test"]);
    expect(SANDBOX_TEST_ALIASES.filter((a) => !MODEL_SHELL_TEST_ALIASES.includes(a))).toEqual(["pnpm run test"]);
    expect(MODEL_SHELL_TEST_ALIASES.filter((a) => !SANDBOX_TEST_ALIASES.includes(a))).toEqual([]);
  });

  it("映射器本身：去空白比对、名单外逐字不动、带参数的 pnpm test 不算命中", () => {
    expect(mapSandboxTestCommand("  pnpm run test  ")).toContain("vitest");
    expect(mapSandboxTestCommand("pnpm test", MODEL_SHELL_TEST_ALIASES)).toContain("vitest");
    expect(mapSandboxTestCommand("pnpm run test", MODEL_SHELL_TEST_ALIASES)).toBe("pnpm run test");
    expect(mapSandboxTestCommand("pnpm test --reporter=verbose")).toBe("pnpm test --reporter=verbose");
  });
});
