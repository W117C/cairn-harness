// 沙箱取消（2026-10-21 核心评审修）：macOS 发货路径过去没有 signal，
// runCancel / verify 取消只到进程边界就丢了——sleep 60 仍在跑，loop 干等超时。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { checkSandbox, runInSandbox } from "../src/main/sandbox";
import { verifyExec } from "../src/main/agent-runner";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("沙箱取消", () => {
  it("abort 立即杀掉沙箱进程组，结果标记取消而不是等超时", async () => {
    const status = await checkSandbox();
    if (!status.available) return; // 非 macOS/沙箱不可用的宿主：这条能力无发货路径
    const ac = new AbortController();
    const started = Date.now();
    const pending = runInSandbox("sleep 30", { cwd: tmpdir(), signal: ac.signal, timeoutMs: 60_000 });
    setTimeout(() => ac.abort(), 200);
    const r = await pending;
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("取消");
  });

  it("verifyExec 把 signal 传到执行器（沙箱分支不再丢第四参）", async () => {
    const ac = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const exec = verifyExec({ available: true }, async (command, opts) => {
      seen.push(opts.signal);
      return { command, ok: true, output: "", exitCode: 0 };
    });
    await exec("true", tmpdir(), 1000, ac.signal);
    expect(seen[0]).toBe(ac.signal);
  });

  it("接线：run_shell 沙箱支与 worker shell 出口都带 signal", () => {
    expect(read("../src/main/tool-gates.ts")).toContain("network, ...(ctx.signal ? { signal: ctx.signal } : {})");
    expect(read("../src/main/session-assembly.ts")).toContain('network: "deny", ...(ctx.signal ? { signal: ctx.signal } : {})');
  });
});
