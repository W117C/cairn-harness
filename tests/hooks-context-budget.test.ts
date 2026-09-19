// hook 输出的**聚合**预算与阻断理由的有界性（能力 9 成本面 + 能力 7 外部文本面）。
// 逐个 handler 各有 10k 上限，不等于拼起来的 additionalContext 有界；而那一串要进
// 每条 tool_result 尾部（loop.ts）与每轮系统文本（agent-runner.ts）。
// 注意 dedupKey = handler.command 的 JSON ⇒ 每个 handler 必须给不同命令，否则跨层去重会并成一个。
import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HookEngine, HOOK_CONTEXT_TOTAL_CHAR_LIMIT, HOOK_REASON_CHAR_LIMIT,
  type HookEngineOptions, type HookEventName,
} from "../src/agent/plugins";
import type { LoadedHookDef } from "../src/agent/plugins";

const filler = (n: number, tag: string): string => tag + "z".repeat(Math.max(0, n - tag.length));

interface Outcome { stdout?: string; stderr?: string; code?: number }

function hooksFor(event: HookEventName, count: number): LoadedHookDef[] {
  return Array.from({ length: count }, (_unused, i) => ({
    plugin: "p" + String(i),
    pluginRoot: "/tmp",
    event,
    handler: { type: "command" as const, command: "hook-" + String(i) },
    loaded: true,
  }));
}

async function engine(event: HookEventName, outcomes: Outcome[]): Promise<HookEngine> {
  const root = await mkdtemp(join(tmpdir(), "hook-budget-"));
  const exec: HookEngineOptions["exec"] = async (command) => {
    const text = Array.isArray(command) ? command.join(" ") : String(command);
    const i = Number(text.slice("hook-".length));
    const o = outcomes[Number.isInteger(i) ? i : 0]!;
    return { stdout: o.stdout ?? "", stderr: o.stderr ?? "", code: o.code ?? 0, killed: false };
  };
  return new HookEngine({
    hooks: hooksFor(event, outcomes.length),
    workspace: root,
    pluginDataRoot: root,
    mode: "auto",
    exec,
  });
}

describe("hook 上下文聚合预算", () => {
  it("四个 9k handler（逐个都在单块上限内）拼不过聚合预算，超出的整块省略并如实报出", async () => {
    const e = await engine("PostToolUse", [
      { stdout: filler(9000, "AAAA") }, { stdout: filler(9000, "BBBB") },
      { stdout: filler(9000, "CCCC") }, { stdout: filler(9000, "DDDD") },
    ]);
    const r = await e.run("PostToolUse", { event: "PostToolUse" });
    expect(r.ran).toBe(4); // 四个 handler 都真跑了（不是被去重成一个）
    const kept = r.additionalContext;
    expect(kept.length).toBeLessThanOrEqual(HOOK_CONTEXT_TOTAL_CHAR_LIMIT + 200); // 200 = 提示行预留
    expect(kept).toContain("AAAA");
    expect(kept).toContain("BBBB");
    expect(kept).not.toContain("CCCC"); // 整块省略，不是留半句冒充全文
    expect(r.droppedContextHandlers).toEqual(["p2", "p3"]);
    expect(kept).toContain("整块省略 2 个 handler 输出（插件 p2、p3）");
  });

  it("预算内的多 handler 逐字拼接（零回归：不加任何提示）", async () => {
    const e = await engine("PostToolUse", [{ stdout: "A" }, { stdout: "B" }]);
    const r = await e.run("PostToolUse", { event: "PostToolUse" });
    expect(r.additionalContext).toBe("A\nB");
    expect(r.droppedContextHandlers).toEqual([]);
  });

  it("单块 10k 仍是第一道闸：三块 30k 先各自被收到 10k，再由聚合预算省掉最后一块", async () => {
    const e = await engine("PostToolUse", [
      { stdout: filler(30000, "XXXX") }, { stdout: filler(30000, "YYYY") }, { stdout: filler(30000, "ZZZZ") },
    ]);
    const r = await e.run("PostToolUse", { event: "PostToolUse" });
    expect(r.droppedContextHandlers).toEqual(["p2"]);
    expect(r.overflowFiles.length).toBe(3); // 三块都超单块上限 ⇒ 全文都落了盘，省略不等于丢失
  });
});

describe("hook 阻断理由有界", () => {
  it("JSON deny 的 reason 不再无界（它进的是 tool_result 里的一行）", async () => {
    const reason = "为什么不行：\n" + "r".repeat(50000);
    const e = await engine("PreToolUse", [{ stdout: JSON.stringify({ decision: "block", reason }) }]);
    const r = await e.run("PreToolUse", { event: "PreToolUse", tool_name: "write_file", tool_args: {} });
    expect(r.blocked).toBe(true);
    expect((r.blockReason ?? "").length).toBeLessThanOrEqual(HOOK_REASON_CHAR_LIMIT + 40);
    expect(r.blockReason).toContain("hook 理由超 " + String(HOOK_REASON_CHAR_LIMIT) + " 字符，已截断");
  });

  it("exit 2 的 stderr 同样收到理由预算（原先跟着输出上限走，10k 当理由太长）", async () => {
    const e = await engine("PreToolUse", [{ stdout: "", stderr: "e".repeat(50000), code: 2 }]);
    const r = await e.run("PreToolUse", { event: "PreToolUse", tool_name: "write_file", tool_args: {} });
    expect(r.blocked).toBe(true);
    expect((r.blockReason ?? "").length).toBeLessThanOrEqual(HOOK_REASON_CHAR_LIMIT + 40);
  });

  it("短理由逐字保留（零回归）", async () => {
    const e = await engine("PreToolUse", [{ stdout: JSON.stringify({ decision: "block", reason: "不许写这个文件" }) }]);
    const r = await e.run("PreToolUse", { event: "PreToolUse", tool_name: "write_file", tool_args: {} });
    expect(r.blockReason).toBe("不许写这个文件");
  });
});
