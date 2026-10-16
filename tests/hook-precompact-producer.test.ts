// §9.5 PreCompact 的**生产端**。压缩有三条路：手动 /compact、阈值 auto、超窗 overflow，
// 而三条都经过 runCompaction。发点放在 runCompaction 上是"一次还是三次"的问题；
// 放在各调用方就变成分散复制——历史上手动分支自己发过一次，auto 档从没人发，
// 于是按 `PreCompact(auto)` 写 matcher 的钩子永不命中（§9.5 表里那一半是空的）。
// 哨兵一律**计数**：跑没跑看得出，跑几遍看不出——"同一个事件发两遍"正是这条链上最容易犯的错
// （tests/hook-session-end.test.ts 的 SessionEnd 双生产者就是前车之鉴）。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import { projectContext } from "../src/agent/context";
import {
  calibrateFactor,
  CompactionCoordinator,
  createMockSummarizer,
  estimateContextTokens,
  runCompaction,
  type CompactDecision,
} from "../src/agent/compaction";
import { createSessionProvider } from "../src/agent/session-provider";
import { HookEngine } from "../src/agent/plugins";
import type { LoadedHookDef } from "../src/agent/plugins/types";
import { compactSessionLog } from "../src/main/agent-runner";

const GOAL = "修复 todo 应用的排序 bug";
const user = (content: string): AgentEvent => ({ type: "user_message", content });
const say = (content: string): AgentEvent => ({ type: "assistant_message", content });
const call = (id: string, name: string, args: Record<string, unknown>): AgentEvent => ({ type: "tool_call", id, name, args });
const result = (callId: string, output: string): AgentEvent => ({ type: "tool_result", callId, ok: true, output });

const SHORT_SUMMARY = [
  "## Objective",
  "- " + GOAL,
  "## Important Details",
  "- 排序函数未过滤 done 项",
  "## Work State",
  "### Completed",
  "- 已定位 src/todo.ts 的 completedCount",
  "### Active",
  "- 无",
  "### Blocked",
  "- 无",
  "## Next Move",
  "- 修改后跑 pnpm test 验证",
  "## Relevant Files",
  "- src/todo.ts（写，修复点）",
].join("\n");

/** 触发阈值自整定：可用 900、tail 50–200 → 下面那组事件必然留出可压缩段。 */
const TINY = { inputLimit: 1000, maxOutputReserve: 100, tailMinTokens: 50, tailMaxTokens: 200, retryBackoffMs: 1 };

function session(): AgentEvent[] {
  return [
    user(GOAL),
    say("开始"),
    call("t1", "read_file", { path: "src/todo.ts" }),
    result("t1", "x".repeat(3000)),
    call("t2", "read_file", { path: "src/tests.ts" }),
    result("t2", "y".repeat(3000)),
    say("完成"),
  ];
}

let dir: string | undefined;
const savedEnv: Record<string, string | undefined> = {};
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete savedEnv[k];
  }
  vi.restoreAllMocks();
});

function useEnv(name: string, value: string | undefined): void {
  if (!(name in savedEnv)) savedEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("PreCompact 发点在 runCompaction（三条压缩路径的唯一必经）", () => {
  it("manual / auto / overflow 三条都发，且 trigger 按 §9.5 表映射（overflow 归 auto）", async () => {
    const cases: { trigger: "manual" | "auto" | "overflow"; reason: "user_request" | "threshold" | "hard_buffer"; want: "manual" | "auto" }[] = [
      { trigger: "manual", reason: "user_request", want: "manual" },
      { trigger: "auto", reason: "threshold", want: "auto" },
      { trigger: "overflow", reason: "hard_buffer", want: "auto" },
    ];
    for (const c of cases) {
      const fired: string[] = [];
      const outcome = await runCompaction({
        events: session(),
        trigger: c.trigger,
        reason: c.reason,
        ...(c.trigger === "overflow" ? {} : { summarizer: createMockSummarizer(SHORT_SUMMARY) }),
        config: TINY,
        onPreCompact: async (t) => { fired.push(t); },
      });
      expect(outcome.ok, c.trigger + " 压缩本身应成功").toBe(true);
      expect(fired, c.trigger + " 应恰好发一次，值为 " + c.want).toEqual([c.want]);
    }
  });

  it("发点在摘要器之前（钩子看到的是压缩前的上下文，不是已经压完的）", async () => {
    const seq: string[] = [];
    const outcome = await runCompaction({
      events: session(),
      trigger: "manual",
      reason: "user_request",
      summarizer: async () => { seq.push("summarize"); return { text: SHORT_SUMMARY }; },
      config: TINY,
      onPreCompact: async () => { seq.push("hook"); },
    });
    expect(outcome.ok).toBe(true);
    expect(seq).toEqual(["hook", "summarize"]);
  });

  it("钩子抛错只告警，压缩照做（fail-visible 不等于 fail-closed）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const outcome = await runCompaction({
      events: session(),
      trigger: "manual",
      reason: "user_request",
      summarizer: createMockSummarizer(SHORT_SUMMARY),
      config: TINY,
      onPreCompact: async () => { throw new Error("钩子炸了"); },
    });
    expect(outcome.ok).toBe(true);
    expect(warn.mock.calls.map((c) => String(c[0]) + String(c[1] ?? ""))).toContainEqual(
      expect.stringContaining("钩子炸了"),
    );
  });

  it("压缩没开始就不发：decision=null 不发；摘要停用后 auto 不发，overflow 截断照发", async () => {
    const fired: string[] = [];
    const boom = async () => { throw new Error("摘要器不可用"); };
    const coord = new CompactionCoordinator({
      config: { ...TINY, maxConsecutiveFailures: 2 },
      summarizer: boom,
      onPreCompact: async (t) => { fired.push(t); },
    });
    const auto: CompactDecision = { trigger: "auto", reason: "threshold" };
    expect(await coord.maybeCompact(session(), null)).toBeNull();
    expect(fired).toEqual([]); // 没开始压缩就没有"压缩前"
    expect((await coord.maybeCompact(session(), auto))?.ok).toBe(false);
    expect((await coord.maybeCompact(session(), auto))?.ok).toBe(false);
    expect(fired).toEqual(["auto", "auto"]);
    expect(coord.summarizerDisabled).toBe(true);
    expect(await coord.maybeCompact(session(), auto)).toBeNull();
    expect(fired.length, "停用后 auto 档直接跳过，不得白发一次钩子").toBe(2);
    const overflow: CompactDecision = { trigger: "overflow", reason: "hard_buffer" };
    expect((await coord.maybeCompact(session(), overflow))?.ok).toBe(true);
    expect(fired).toEqual(["auto", "auto", "auto"]); // 截断仍是压缩
  });
});

describe("自动档经 session-provider 接到生产者（provider 是唯一发起方）", () => {
  it("组装前触发的压缩发出 PreCompact(auto)，且只发一次", async () => {
    useEnv("CAIRN_API_KEY", undefined); // 压缩后仍要调模型 → 无 key 在此抛错（抛错在压缩之后 = 接线生效）
    dir = await mkdtemp(join(tmpdir(), "dsh-precompact-auto-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    for (const e of session()) await log.append(e);
    const fired: string[] = [];
    const factor = calibrateFactor(session());
    const est = estimateContextTokens(projectContext(session()), {}, factor);
    const provider = createSessionProvider(logPath, {
      compaction: {
        // 自整定（同 compaction.test.ts 的接线用例）：可用 = est+4，ratio 0.5 → 必然触发，
        // 且压缩后的投影（tail ≤200 + 摘要）仍落在预算内 → 一路走到"要调模型"才因无 key 抛错。
        config: { ...TINY, inputLimit: est + 5, maxOutputReserve: 1, ratio: 0.5 },
        summarizer: createMockSummarizer(SHORT_SUMMARY),
        onPreCompact: async (t) => { fired.push(t); },
      },
    });
    await expect(async () => {
      for await (const _e of provider.stream([], [])) void _e;
    }).rejects.toThrow(/CAIRN_API_KEY/);
    expect(fired).toEqual(["auto"]);
  });
});

describe("手动档真跑钩子引擎（不注入 exec：matcher 与「只发一次」只能在真实 spawn 上验）", () => {
  /** 往哨兵文件追加一个 'x' 的钩子脚本（计数可见）。 */
  async function appendScript(d: string, name: string): Promise<string> {
    const p = join(d, name);
    await writeFile(p, "require('fs').appendFileSync(process.argv[2], 'x');\n", "utf8");
    return 'node "' + p + '"';
  }

  function mk(command: string, matcher?: string): LoadedHookDef {
    return {
      plugin: "precompact-" + (matcher ?? "any"), pluginRoot: process.cwd(), event: "PreCompact",
      handler: { type: "command", command }, loaded: true, ...(matcher === undefined ? {} : { matcher }),
    };
  }

  async function bigLog(): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "dsh-precompact-manual-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    await log.append(user(GOAL));
    for (let i = 0; i < 6; i++) {
      await log.append(call("t" + String(i), "read_file", { path: "src/a.ts" }));
      await log.append(result("t" + String(i), "z".repeat(2000)));
    }
    await log.append(say("完成"));
    return logPath;
  }

  it("matcher=manual 的那条恰好跑一次，matcher=auto 的那条不跑", async () => {
    useEnv("M1D_COMPACTION_DEMO", "1"); // 无 key 时的显式演示档：mock 摘要器
    useEnv("CAIRN_API_KEY", undefined);
    const logPath = await bigLog();
    const script = await appendScript(dir!, "touch.cjs");
    const hit = join(dir!, "hit-manual");
    const miss = join(dir!, "hit-auto");
    const engine = new HookEngine({
      hooks: [
        mk(script + " " + JSON.stringify(hit), "manual"),
        mk(script + " " + JSON.stringify(miss), "auto"),
      ],
      workspace: dir!, pluginDataRoot: dir!, mode: "auto",
    });
    const res = await compactSessionLog(logPath, undefined, engine);
    expect(res.ok, res.error ?? "").toBe(true);
    expect(await readFile(hit, "utf8")).toBe("x"); // 两遍 = compactSessionLog 与 runCompaction 各发一次
    await expect(readFile(miss, "utf8")).rejects.toBeTruthy();
    const events = await replay(logPath);
    expect(events[events.length - 1]?.type).toBe("compaction"); // 钩子没把它拦掉
  });

  it("无钩子引擎时零行为（不因为接线就凭空造一次 run）", async () => {
    useEnv("M1D_COMPACTION_DEMO", "1");
    useEnv("CAIRN_API_KEY", undefined);
    const logPath = await bigLog();
    const res = await compactSessionLog(logPath);
    expect(res.ok, res.error ?? "").toBe(true);
  });
});
