// 优化轮次回归：边界与错误处理加固（本轮可单测部分的防线）。
// ① edit_file 替换走字面量语义（$& / $1 / $` 不被当替换模式解释）
// ② read_file 超大文件只读前缀且显式声明（不再整读进内存）
// ③ prune 附件名清洗（模型可控 callId 不能越出附件目录）+ 预建索引与原判定路径等价
// ④ verify 钩子抛错记为「一次验证失败」，不炸整轮任务
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { edit_file } from "../src/tools/edit_file";
import { read_file } from "../src/tools/read_file";
import {
  attachmentPathFor,
  buildPruneIndex,
  computePrune,
  DEFAULT_PRUNE_CONFIG,
  isPruneExempt,
  writePruneAttachments,
} from "../src/agent/prune";
import { runLoop } from "../src/agent/loop";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import type { ModelOutput } from "../src/providers";
import type { ToolContext } from "../src/tools";

const KB = 1024;

let ws = "";
afterEach(async () => {
  if (ws) await rm(ws, { recursive: true, force: true });
});

async function newCtx(): Promise<ToolContext> {
  ws = await mkdtemp(join(tmpdir(), "edge-cases-"));
  return { workspace: ws };
}

describe("edit_file：替换一律字面量语义", () => {
  it("new_string 里的 $& / $1 / $` 原样写入，不被展开为替换模式", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "a.ts"), "const TOKEN = 1;\n", "utf8");
    // $& = 整个匹配、$1 = 捕获组、$` = 匹配前文本；若走 String.replace 的模式语义会被展开
    const res = await edit_file.run({ path: "a.ts", old_string: "TOKEN", new_string: "A$&B$1C$`D" }, ctx);
    expect(res.ok).toBe(true);
    expect(await readFile(join(ws, "a.ts"), "utf8")).toBe("const A$&B$1C$`D = 1;\n");
  });

  it("replace_all 分支同口径（split/join 亦为字面量，两分支不再互相矛盾）", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "b.ts"), "x\nx\n", "utf8");
    const res = await edit_file.run({ path: "b.ts", old_string: "x", new_string: "$&", replace_all: true }, ctx);
    expect(res.ok).toBe(true);
    expect(await readFile(join(ws, "b.ts"), "utf8")).toBe("$&\n$&\n");
  });
});

describe("read_file：超大文件只读前缀", () => {
  it("超过 16MB 只读前 16MB 并显式声明截断（旧实现整读进内存）", async () => {
    const ctx = await newCtx();
    await writeFile(join(ws, "big.log"), Buffer.alloc(17 * 1024 * 1024, 0x61)); // 'a' × 17MB
    const res = await read_file.run({ path: "big.log" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("仅读取前 16 MB");
    // 输出仍受 50KB/行截断上限约束（没有把 17MB 原样吐出来）
    expect(res.output.length).toBeLessThan(64 * KB);
  });
});

describe("prune：附件名清洗与索引等价", () => {
  /** 三轮各 30k 的旧会话：第 1 轮必被裁（与 prune.test ④ 同构）。 */
  const threeRounds = (firstCallId: string): AgentEvent[] => [
    { type: "user_message", content: "任务" },
    { type: "tool_call", id: firstCallId, name: "read_file", args: {} },
    { type: "tool_result", callId: firstCallId, ok: true, output: "Z".repeat(120 * KB) },
    { type: "user_message", content: "r2" },
    { type: "tool_call", id: "f1", name: "read_file", args: {} },
    { type: "tool_result", callId: "f1", ok: true, output: "F".repeat(120 * KB) },
    { type: "user_message", content: "r3" },
    { type: "tool_call", id: "g2", name: "read_file", args: {} },
    { type: "tool_result", callId: "g2", ok: true, output: "G".repeat(120 * KB) },
  ];

  it("模型可控 callId 含 ../ 时不越出附件目录（目录穿越），且三处命名口径一致可回取", async () => {
    const dir = await mkdtemp(join(tmpdir(), "edge-prune-"));
    const evil = "../../../../tmp/evil";
    const events = threeRounds(evil);
    const outcome = computePrune({ events, attachmentsDir: dir, sessionId: "s1" });
    expect(outcome.why).toBe("saved");
    await writePruneAttachments(events, outcome, dir, "s1");
    const names = await readdir(dir);
    expect(names.length).toBe(1);
    // 落盘文件必须仍在附件目录内（resolve 后以 dir 为前缀）；digest 前缀保证不会退化成 ".."
    expect(resolve(dir, names[0]!).startsWith(resolve(dir) + "/")).toBe(true);
    // 命名口径在 computePrune / writePruneAttachments / attachmentPathFor 三处一致
    expect(await readFile(attachmentPathFor(dir, "s1", evil), "utf8")).toBe("Z".repeat(120 * KB));
  });

  it("附件位置预置软链时拒绝跟随，链接目标保持原样", async () => {
    const dir = await mkdtemp(join(tmpdir(), "edge-prune-link-"));
    const victim = join(dir, "victim.txt");
    await writeFile(victim, "original", "utf8");
    const evil = "../../../../tmp/evil";
    const events = threeRounds(evil);
    const outcome = computePrune({ events, attachmentsDir: dir, sessionId: "s1" });
    await symlink(victim, attachmentPathFor(dir, "s1", evil));
    await writePruneAttachments(events, outcome, dir, "s1");
    expect(await readFile(victim, "utf8")).toBe("original");
    await rm(dir, { recursive: true, force: true });
  });

  it("预建索引路径与原就地判定路径逐位等价（O(n) 优化不改变语义）", () => {
    const events = threeRounds("c1");
    const idx = buildPruneIndex(events, DEFAULT_PRUNE_CONFIG);
    for (let i = 0; i < events.length; i++) {
      expect(isPruneExempt(events, i, DEFAULT_PRUNE_CONFIG, idx)).toBe(
        isPruneExempt(events, i, DEFAULT_PRUNE_CONFIG),
      );
    }
  });
});

describe("verify 钩子异常：记为一次环境失败（不占修复额度），不炸整轮任务", () => {
  function scriptedProvider(script: ModelOutput[]): {
    provider: { next(): Promise<ModelOutput | null> };
    calls: () => number;
  } {
    let i = 0;
    let calls = 0;
    return {
      provider: {
        async next() {
          calls++;
          const v = script[i];
          i++;
          return v ?? null;
        },
      },
      calls: () => calls,
    };
  }

  it("钩子抛错 → verify_result(ok:false) + tool_result 带真实原因；达环境上限后停止", async () => {
    const logPath = join(tmpdir(), `edge-verify-${String(Date.now())}-${String(Math.random()).slice(2, 8)}.jsonl`);
    const events = createEventLog(logPath);
    const { provider, calls } = scriptedProvider([
      { type: "tool_call", id: "v1", name: "verify", args: {} },
      { type: "tool_call", id: "v2", name: "verify", args: {} },
      { type: "assistant_message", content: "不应被消费" },
    ]);
    const hook = {
      maxAttempts: 2,
      run: async (): Promise<never> => {
        throw new Error(".agent/config.json 损坏");
      },
    };
    await runLoop({ provider, events, workspace: tmpdir(), mode: "auto", verify: hook });
    const log = await replay(logPath);
    const verifyResults = log.filter((e): e is Extract<AgentEvent, { type: "verify_result" }> => e.type === "verify_result");
    expect(verifyResults.map((e) => e.ok)).toEqual([false, false]);
    const toolResults = log.filter((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result");
    // 首次失败：异常原因进 tool_result（fail-visible，不是「无详细输出」）
    expect(toolResults[0]?.output).toContain("钩子异常");
    expect(toolResults[0]?.output).toContain(".agent/config.json 损坏");
    // 末次失败：走「harness 侧原因」收口文案（tool_call 不悬空）。
    // 2026-09-23 起钩子异常归 `hook-error`（环境类），所以它**不**再消耗 maxVerify 修复额度、
    // 也不再用「已达上限」那句判模型——但"有界停止 + 原因可见"这两条不变，下面逐条钉住。
    expect(toolResults[toolResults.length - 1]?.output).toContain("因 harness 侧原因未能执行验证");
    expect(toolResults[toolResults.length - 1]?.output).toContain("cause=hook-error");
    expect(toolResults[toolResults.length - 1]?.output).toContain("不是代码失败");
    // 达上限即停：收尾消息从未被消费
    expect(log.some((e) => e.type === "assistant_message")).toBe(false);
    expect(calls()).toBe(2);
  });
});
