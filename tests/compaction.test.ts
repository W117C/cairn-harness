import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import { projectContext, summaryEnvelope } from "../src/agent/context";
import {
  DEFAULT_COMPACTION_CONFIG,
  CompactionCoordinator,
  atomicUnits,
  calibrateFactor,
  compactionCardPayload,
  createMockSummarizer,
  estimateContextTokens,
  withModelBudget,
  estimateTokens,
  keepFirstSet,
  runCompaction,
  selectCut,
  serializeConversation,
  shouldCompact,
} from "../src/agent/compaction";
import { createSessionProvider } from "../src/agent/session-provider";
import { withAgentId } from "../src/agent/worker-projection";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const GOAL = "修复 todo 应用的排序 bug";

function user(content: string): AgentEvent {
  return { type: "user_message", content };
}
function say(content: string): AgentEvent {
  return { type: "assistant_message", content };
}
function call(id: string, name: string, args: Record<string, unknown>): AgentEvent {
  return { type: "tool_call", id, name, args };
}
function result(callId: string, output: string): AgentEvent {
  return { type: "tool_result", callId, ok: true, output };
}
function compactionEvent(ids: number[], offset: number, summary: string): AgentEvent {
  return { type: "compaction", trigger: "auto", reason: "threshold", compressed_event_ids: ids, summary, summary_offset: offset, tokens_before: 999, tokens_after: 100 };
}

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

const TINY = { inputLimit: 1000, maxOutputReserve: 100, tailMinTokens: 50, tailMaxTokens: 200, retryBackoffMs: 1 };

describe("token 估算与触发判定", () => {
  it("chars/4 估算 + usage 事件校准", () => {
    expect(estimateTokens(400)).toBe(100);
    const events: AgentEvent[] = [
      say("abcd".repeat(100)), // 400 chars
      { type: "usage", inputTokens: 10, outputTokens: 80 },
    ];
    expect(calibrateFactor(events)).toBeCloseTo(5); // 400 chars / 80 tokens
  });

  it("system 开销全量计入：同一对话去掉 system 后触发点明显后移", () => {
    const config: typeof DEFAULT_COMPACTION_CONFIG = {
      ...DEFAULT_COMPACTION_CONFIG,
      inputLimit: 1000,
      maxOutputReserve: 100,
      ratio: 0.9,
    };
    const msgs = [{ role: "user" as const, content: "x".repeat(2800) }]; // ≈707 token（含 JSON 包装字符）
    const withOverhead = estimateContextTokens(msgs, { systemChars: 700 }, 4); // 707+175≈882 ∈ [810,900] A 段
    const without = estimateContextTokens(msgs, {}, 4); // ≈708 < 810
    expect(shouldCompact(withOverhead, config)).toEqual({ trigger: "auto", reason: "threshold" });
    expect(shouldCompact(without, config)).toBeNull(); // 不计 system 开销就晚触发（这里根本不触发）
  });

  it("双条件各自独立触发：比例条件与硬兜底条件", () => {
    const config: typeof DEFAULT_COMPACTION_CONFIG = { ...DEFAULT_COMPACTION_CONFIG, inputLimit: 1000, maxOutputReserve: 100 };
    // 可用 = 900：A 段 [810, 900] → auto/threshold；B 段 > 900 → overflow/hard_buffer
    expect(shouldCompact(850, config)).toEqual({ trigger: "auto", reason: "threshold" });
    expect(shouldCompact(901, config)).toEqual({ trigger: "overflow", reason: "hard_buffer" });
    expect(shouldCompact(500, config)).toBeNull();
  });
});

describe("组装投影（compaction 感知）", () => {
  const events: AgentEvent[] = [
    user(GOAL), // 1 keep-first
    { type: "assistant_delta", callId: "a1", text: "先看" }, // 2
    { type: "assistant_delta", callId: "a1", text: "代码" }, // 3
    call("t1", "read_file", { path: "src/todo.ts" }), // 4
    result("t1", "..."), // 5
    say("修好了"), // 6
    compactionEvent([2, 3, 4, 5], 6, "SUM1"), // 7
  ];

  it("跳过被压 id、在 offset 注入 user 角色摘要（fresh start）", () => {
    const msgs = projectContext(events);
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toEqual({ role: "user", content: GOAL });
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toBe(summaryEnvelope("SUM1"));
    expect(msgs[2]).toEqual({ role: "assistant", content: "修好了" });
  });

  it("幂等：同一事件集投影两次逐字一致", () => {
    expect(projectContext(events)).toEqual(projectContext(events));
  });

  it("重放投影 === 活会话投影", async () => {
    dir = await mkdtemp(join(tmpdir(), "m1d-proj-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    for (const e of events) await log.append(e);
    expect(projectContext(await replay(logPath))).toEqual(projectContext(events));
  });

  it("滚动合并：新摘要整合旧摘要，旧摘要不再注入；compaction 事件本体不进消息", () => {
    const withSecond: AgentEvent[] = [
      ...events,
      call("t2", "read_file", { path: "src/other.ts" }), // 8
      result("t2", ".."), // 9
      compactionEvent([4, 5, 6, 8, 9], 7, "SUM2"), // 10（旧 compaction id=7 永不被吞）
    ];
    const msgs = projectContext(withSecond);
    expect(msgs).toHaveLength(2); // goal + 最新摘要（tail 为空，末尾补注）
    expect(msgs[1].content).toBe(summaryEnvelope("SUM2"));
    expect(JSON.stringify(msgs)).not.toContain("SUM1");
  });
});

describe("切点三纪律", () => {
  it("tool_use/tool_result 对不拆：tailStart 落在单元内 → 回退到单元起点", () => {
    const events: AgentEvent[] = [
      user(GOAL), // 1 keep-first（也是最近 typed user，但受固定回注保护）
      call("t1", "read_file", { path: "a".repeat(500) }), // 2 大参数 ≈140 token
      result("t1", "r"), // 3 小
      say("ok"), // 4 小
    ];
    const units = atomicUnits(events);
    expect(units).toContainEqual(expect.objectContaining({ lo: 2, hi: 3 }));
    const cut = selectCut(events, { ...DEFAULT_COMPACTION_CONFIG, tailMinTokens: 25, tailMaxTokens: 30 }, {
      availableTokens: 1000,
      factor: 4,
      keepFirst: keepFirstSet(events),
      excluded: new Set(),
      lastUserMsgId: 1,
      units,
    });
    // 预算 25：装得下 4、3（≈25 token），装不下 2（≈140）→ tailStart=3 落在 [2,3] 单元内 → 回退到 2
    expect(cut.offset).toBe(2);
    expect(cut.compressedIds).toEqual([]); // 只剩 keep-first（1），无可压
  });

  it("最近 typed 用户消息永不吞 + keep-first 永不进压缩与摘要输入", async () => {
    const events: AgentEvent[] = [
      user(GOAL), // 1
      say("开始"), // 2
      call("t1", "read_file", { path: "src/todo.ts" }), // 3
      result("t1", "x".repeat(2000)), // 4
      call("t2", "write_file", { path: "src/todo.ts", content: "y" }), // 5
      result("t2", "done"), // 6
      user("再验证一次"), // 7 最近 typed user
      say("好"), // 8
    ];
    const config = { ...DEFAULT_COMPACTION_CONFIG, ...TINY };
    const outcome = await runCompaction({
      events,
      trigger: "auto",
      reason: "threshold",
      summarizer: createMockSummarizer(SHORT_SUMMARY),
      config,
    });
    if (!outcome.ok) throw new Error(outcome.why);
    const ids = outcome.event.compressed_event_ids;
    expect(ids).not.toContain(1); // 固定回注（用户目标）
    expect(ids).not.toContain(7); // 最近 typed user 消息
    expect(ids).toContain(3);
    expect(ids).toContain(4); // 对不拆：成对同压
    const input = serializeConversation(ids.map((id) => events[id - 1]), 2000);
    expect(input).not.toContain(GOAL); // keep-first 不进摘要输入
    expect(input).not.toContain("再验证一次");
  });
});

describe("质量闸与降级链", () => {
  const baseEvents: AgentEvent[] = [
    user(GOAL),
    say("开始"),
    call("t1", "read_file", { path: "src/todo.ts" }),
    result("t1", "x".repeat(800)),
    call("t2", "write_file", { path: "src/todo.ts", content: "y" }),
    result("t2", "done"),
    say("完成"),
  ];

  it("空摘要拒绝，不落流", async () => {
    const outcome = await runCompaction({
      events: baseEvents,
      trigger: "auto",
      reason: "threshold",
      summarizer: createMockSummarizer("   "),
      config: TINY,
    });
    expect(outcome).toEqual({ ok: false, kind: "rejected", why: "空摘要被拒" });
  });

  it("没收尾的摘要拒绝：半句话不得替掉它替掉的旧事件", async () => {
    const outcome = await runCompaction({
      events: baseEvents,
      trigger: "auto",
      reason: "threshold",
      summarizer: async () => ({ text: "读到排序逻辑在这里被——", truncated: "length" }),
      config: TINY,
    });
    expect(outcome).toEqual({
      ok: false,
      kind: "rejected",
      why: "摘要没写完就被收走（停止原因 length）",
    });
  });

  it("负控：truncated 缺席 ⇒ 第四闸不动作（否则整条压缩链被自己闸死）", async () => {
    // 与上一条同一份文本，唯一差别就是这个字段缺席 ⇒ 判的是字段本身，不是措辞长短。
    const outcome = await runCompaction({
      events: baseEvents,
      trigger: "auto",
      reason: "threshold",
      summarizer: async () => ({ text: SHORT_SUMMARY }),
      config: TINY,
    });
    expect(outcome.ok).toBe(true);
  });

  it("空摘要闸在前：既空又被收走时先报「空」（可行动的那条排前面）", async () => {
    const outcome = await runCompaction({
      events: baseEvents,
      trigger: "auto",
      reason: "threshold",
      summarizer: async () => ({ text: "   ", truncated: "content_filter" }),
      config: TINY,
    });
    expect(outcome).toEqual({ ok: false, kind: "rejected", why: "空摘要被拒" });
  });

  it("膨胀拒绝：tokens_after ≥ tokens_before", async () => {
    const outcome = await runCompaction({
      events: baseEvents,
      trigger: "auto",
      reason: "threshold",
      // 超帽以下（600 token < 4096）、但比被压内容长 → 组装后不缩反胀
      summarizer: createMockSummarizer("长".repeat(2400)),
      config: { ...TINY, summaryCapTokens: 4096 },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.why).toContain("膨胀");
  });

  it("最小进度拒绝：被压事件 < 可见事件×0.1", async () => {
    const outcome = await runCompaction({
      events: baseEvents,
      trigger: "auto",
      reason: "threshold",
      summarizer: createMockSummarizer(SHORT_SUMMARY),
      config: { ...TINY, minProgress: 0.9 },
    });
    expect(outcome.ok).toBe(false);
    // 钉**闸报出来的数**（被压 / 可见 / 本次配的 minProgress），不是「最小进度」这四个字：
    // 那四个字在 compaction-check 的闸名里也有一份，测试照抄就成了一把量不到自己的尺
    // （顶包候选）。数字只有生产那一条路算得出来，复制品算不出。
    if (!outcome.ok) expect(outcome.why).toMatch(/被压 \d+ < 可见 \d+ × 0\.9/);
  });

  it("失败退避重试 1 次；连续 2 败 → 停用摘要（auto 跳过，overflow 截断照走）", async () => {
    let calls = 0;
    const flaky = async (): Promise<never> => {
      calls++;
      throw new Error("boom");
    };
    const coordinator = new CompactionCoordinator({ summarizer: flaky, config: { ...TINY } });
    const decision = { trigger: "auto" as const, reason: "threshold" as const };
    const r1 = await coordinator.maybeCompact(baseEvents, decision);
    expect(r1 && !r1.ok && r1.kind).toBe("failed");
    expect(calls).toBe(2); // 重试 1 次
    expect(coordinator.summarizerDisabled).toBe(false); // 1 败未停用
    await coordinator.maybeCompact(baseEvents, decision);
    expect(calls).toBe(4);
    expect(coordinator.summarizerDisabled).toBe(true); // 连续 2 败停用
    const r3 = await coordinator.maybeCompact(baseEvents, decision);
    expect(r3).toBeNull(); // auto 不再尝试
    expect(calls).toBe(4); // 摘要器不再被调
  });

  it("重试后成功即恢复计数", async () => {
    let calls = 0;
    const coordinator = new CompactionCoordinator({
      summarizer: async () => {
        calls++;
        if (calls === 1) throw new Error("first fails");
        return { text: SHORT_SUMMARY };
      },
      config: { ...TINY },
    });
    const outcome = await coordinator.maybeCompact(baseEvents, { trigger: "auto", reason: "threshold" });
    expect(outcome && outcome.ok).toBe(true);
    expect(calls).toBe(2);
    expect(coordinator.summarizerDisabled).toBe(false);
  });
});

describe("overflow 紧急半分截断", () => {
  it("不调摘要器；整单元丢最旧一半；keep-first 与最近 user 消息保留", async () => {
    let summarizerCalls = 0;
    const events: AgentEvent[] = [
      user(GOAL), // 1
      call("t1", "read_file", { path: "a.ts" }), // 2
      result("t1", "r1"), // 3
      call("t2", "read_file", { path: "b.ts" }), // 4
      result("t2", "r2"), // 5
      call("t3", "read_file", { path: "c.ts" }), // 6
      result("t3", "r3"), // 7
      say("中间"), // 8
      user("最新指令"), // 9 最近 typed user
      say("收尾"), // 10
    ];
    const coordinator = new CompactionCoordinator({
      summarizer: async () => {
        summarizerCalls++;
        return { text: SHORT_SUMMARY };
      },
    });
    const outcome = await coordinator.maybeCompact(events, { trigger: "overflow", reason: "hard_buffer" });
    expect(outcome && outcome.ok).toBe(true);
    if (!outcome || !outcome.ok) throw new Error("unreachable");
    expect(summarizerCalls).toBe(0); // 紧急路径不调摘要器
    const e = outcome.event;
    expect(e.trigger).toBe("overflow");
    expect(e.reason).toBe("hard_buffer");
    expect(e.summary).toContain("紧急截断");
    // 那句自述的两半各钉一次：条数要由 id 清单**投影**（写死一个数就露馅），机制说明要留在句子里
    // （模型/运维据此才知道"最近那条用户消息为什么还在"，而不是只看到一个数字）。
    expect(e.summary, "自述里的条数必须与 compressed_event_ids 同源").toContain(
      "已按半分截断摘除 " + String(e.compressed_event_ids.length) + " 条最旧事件",
    );
    expect(e.summary).toContain("原子单元整丢、最近 typed 用户消息未动");
    expect(e.compressed_event_ids).not.toContain(1);
    expect(e.compressed_event_ids).not.toContain(9);
    expect(e.compressed_event_ids.length).toBeGreaterThanOrEqual(4); // 约一半
    expect(e.tokens_after).toBeLessThan(e.tokens_before);
  });
});

describe("手动 /compact 与压缩卡", () => {
  it("手动触发产生 trigger=manual + reason=user_request；卡 payload 字段齐全", async () => {
    const events: AgentEvent[] = [
      user(GOAL),
      say("开始"),
      call("t1", "read_file", { path: "src/todo.ts" }),
      result("t1", "x".repeat(800)),
      say("完成"),
    ];
    const outcome = await runCompaction({
      events,
      trigger: "manual",
      reason: "user_request",
      summarizer: createMockSummarizer(SHORT_SUMMARY),
      config: TINY,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.why);
    expect(outcome.event.trigger).toBe("manual");
    expect(outcome.event.reason).toBe("user_request");
    const payload = compactionCardPayload(outcome.event);
    for (const key of ["trigger", "reason", "compressedCount", "compressedRange", "tokensBefore", "tokensAfter", "savedTokens", "summaryPreview", "type"]) {
      expect(payload).toHaveProperty(key);
    }
    expect(payload.trigger).toBe("manual");
  });

  it("程序化 Files 兜底：摘要缺 Relevant Files 段时强制补", async () => {
    const events: AgentEvent[] = [
      user(GOAL),
      say("开始"),
      call("t1", "read_file", { path: "src/a.ts" }),
      result("t1", "x".repeat(800)),
      call("t2", "write_file", { path: "src/b.ts", content: "y" }),
      result("t2", "done"),
      say("完成"),
    ];
    const noFiles = SHORT_SUMMARY.split("## Relevant Files")[0].trim();
    const outcome = await runCompaction({
      events,
      trigger: "auto",
      reason: "threshold",
      summarizer: createMockSummarizer(noFiles),
      config: TINY,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.why);
    expect(outcome.event.summary).toContain("## Relevant Files");
    expect(outcome.event.summary).toContain("src/a.ts"); // 事件 5（write src/b.ts）在 tail 预算内，不进压缩范围
    expect(outcome.event.summary).not.toContain("src/b.ts");
  });
});

describe("事件流契约", () => {
  it("compaction 事件过 KNOWN_TYPES 且 replay 回读一致；不进自身 compressed_event_ids", async () => {
    dir = await mkdtemp(join(tmpdir(), "m1d-evt-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const e: AgentEvent = {
      type: "compaction",
      trigger: "auto",
      reason: "threshold",
      compressed_event_ids: [1, 2, 3],
      summary: "s",
      summary_offset: 4,
      tokens_before: 500,
      tokens_after: 120,
    };
    await log.append(e);
    const back = await replay(logPath);
    expect(back).toEqual([e]);
    expect(back[0].type).toBe("compaction");
  });
});

describe("session-provider 压缩接线", () => {
  it("组装前触发压缩：compaction 事件先落盘再调模型（fresh start 后才请求）", async () => {
    dir = await mkdtemp(join(tmpdir(), "m1d-glm-"));
    const logPath = join(dir, "events.jsonl");
    const log = createEventLog(logPath);
    const events: AgentEvent[] = [
      user(GOAL),
      call("t1", "read_file", { path: "src/todo.ts" }),
      result("t1", "r".repeat(400)),
      call("t2", "write_file", { path: "src/todo.ts", content: "x" }),
      result("t2", "ok"),
      say("修完"),
    ];
    for (const e of events) await log.append(e);
    const factor = calibrateFactor(events);
    const est = estimateContextTokens(projectContext(events), {}, factor);
    const calls: string[] = [];
    const provider = createSessionProvider(logPath, {
      compaction: {
        // 自整定：可用 = est+4，ratio 0.5 → est ≥ ~4 即触发（本会话 est 远大于此，确定性触发比例条件）
        config: { inputLimit: est + 5, maxOutputReserve: 1, ratio: 0.5, tailMinTokens: 10, tailMaxTokens: 30, retryBackoffMs: 1 },
        summarizer: async () => {
          calls.push("summarize");
          return { text: SHORT_SUMMARY };
        },
      },
    });
    // 压缩后仍要调模型 → 无 key 在此抛错（压缩发生在抛错之前 = 接线生效）
    await expect(async () => {
      for await (const _e of provider.stream([], [])) {
        void _e;
      }
    }).rejects.toThrow(/CAIRN_API_KEY/);
    expect(calls).toEqual(["summarize"]);
    const after = await replay(logPath);
    const last = after[after.length - 1];
    expect(last.type).toBe("compaction");
    if (last.type !== "compaction") throw new Error("unreachable");
    expect(last.trigger).toBe("auto");
    const proj = projectContext(after);
    expect(proj[0]).toEqual({ role: "user", content: GOAL });
    expect(proj[1].content).toBe(summaryEnvelope(last.summary));
    // A10（审查 P3）：以唯一指纹（tool_call.id / 消息全文）断言"真摘除"——旧实现取被压事件
    // JSON 前 40 字符做子串，转义差异下"恰好未命中"与"真摘除"不可区分。
    // 同时加反向断言：未被压缩的事件仍必须在投影里（排除集没有误伤）。
    const compressedIds = new Set(last.compressed_event_ids);
    const projText = JSON.stringify(proj);
    after.forEach((e, i) => {
      const id = i + 1;
      const fingerprint = e.type === "tool_call" ? `"${e.id}"` : JSON.stringify(e).slice(1, 80);
      if (compressedIds.has(id)) expect(projText).not.toContain(fingerprint);
      else if (e.type === "tool_call") expect(projText).toContain(fingerprint);
    });
  });
});
/* 预算认模型的纯函数面（与 session-provider 的端到端差分测同锚点，此处钉回退方向） */
describe("withModelBudget（inputLimit 换成模型真实窗口）", () => {
  it("窗口可得 → 上调也下调，一律取窗口", () => {
    expect(withModelBudget(DEFAULT_COMPACTION_CONFIG, 200_000).inputLimit).toBe(200_000);
    expect(withModelBudget(DEFAULT_COMPACTION_CONFIG, 32_000).inputLimit).toBe(32_000);
  });
  it("窗口不可得 / 非有限 / 非正 → 原样返回（保守回落，不放大也不炸）", () => {
    for (const w of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(withModelBudget(DEFAULT_COMPACTION_CONFIG, w)).toBe(DEFAULT_COMPACTION_CONFIG);
    }
  });
  /* 输出预留要跟着窗口缩（2026-09-30 实测的缺口）。
     旧口径：预留恒 8192，与窗口无关。于是 `--ctx-window 12000` 时可用输入只剩 3808，
     而工具面 + 系统提示词的固定开销 ~3500 ⇒ **连第一轮都发不出去**：
     实测 `[context_budget_exceeded] final estimated input 4471; available 3808`，
     且紧急截断已经跑过（compaction 事件在场）仍塞不下——因为占大头的是工具面，
     压缩历史对它结构性无效。修后同一命令 exit=0、verify ok、4 次压缩、maxInput 6102 < 9000。
     这一格同时废掉了旧断言「窗口 == 预留 ⇒ 原样返回」：那个行为正是缺口本身
     （窗口等于预留时可用输入为 0，不缩放就没有任何可用输入）。 */
  it("★ 小窗口下预留按窗口缩，可用输入必须容得下工具面+系统提示词的固定开销", () => {
    const FLOOR = 3_500; // 实测的固定开销（15 件工具说明书 + 系统提示词）
    for (const w of [8_000, 12_000, 16_000, 32_000]) {
      const c = withModelBudget(DEFAULT_COMPACTION_CONFIG, w);
      expect(c.inputLimit).toBe(w);
      expect(c.maxOutputReserve).toBeLessThanOrEqual(Math.floor(w / 4));
      expect(c.inputLimit - c.maxOutputReserve, `窗口 ${String(w)} 下可用输入要装得下固定开销`).toBeGreaterThan(FLOOR);
    }
  });
  it("大窗口保持缺省预留（不为大窗口白白压小输出空间）", () => {
    expect(withModelBudget(DEFAULT_COMPACTION_CONFIG, 128_000).maxOutputReserve).toBe(8_192);
    expect(withModelBudget(DEFAULT_COMPACTION_CONFIG, 1_000_000).maxOutputReserve).toBe(8_192);
  });
  it("预留有下限 1024：极窄窗口也不给 0（0 预留 = 输出必被砍，那是静默降质）", () => {
    expect(withModelBudget(DEFAULT_COMPACTION_CONFIG, 2_000).maxOutputReserve).toBe(1_024);
    expect(withModelBudget(DEFAULT_COMPACTION_CONFIG, 100).maxOutputReserve).toBe(1_024);
  });
});

describe("摘要输入不含子流（§4.4.4 在折叠面上的那一半）", () => {
  // 动手前的实测：compaction.ts 里 agent_id 零命中——projectContext 早就按「带 agent_id 即子流」
  // 把 worker 事件挡在父上下文外,而摘要走另一条取料路径。摘要会替掉被排除的旧事件并长期留存,
  // 所以 worker 的内部转录一旦混进去,就以「父会话做过这些事」的形态进了父的记忆。
  // 子流事件一律经**生产入口同一份装饰器** withAgentId 生成：既贴真相,也绕开字面量的多余属性检查
  // （assistant_message 的 agent_id 字段还没进类型声明——见下方那条待办）。
  const decorate = (e: AgentEvent): AgentEvent => withAgentId(e, "w1");
  const parent: AgentEvent[] = [
    { type: "user_message", content: "父会话的任务" },
    { type: "assistant_message", content: "父会话的正文" },
  ];
  const child: AgentEvent[] = [
    decorate({ type: "assistant_message", content: "worker 内部正文" }),
    decorate({ type: "tool_result", callId: "t9", ok: true, output: "worker 内部转录" }),
    decorate({ type: "verify_result", callId: "v9", ok: false, attempt: 1, maxAttempts: 3, results: [] }),
    decorate({ type: "turn_truncated", callId: "m9", outcome: "output_budget", stop_reason: "max_tokens" }),
  ];

  it("带归因的四型一个字节都不进摘要输入", () => {
    const text = serializeConversation([...parent, ...child], 2000);
    for (const secret of ["worker 内部正文", "worker 内部转录", "v9", "m9"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("父会话的任务"); // 负控：父侧事件照旧全量在
    expect(text).toContain("父会话的正文");
  });

  it("无归因的同型事件照常进（判定读的是字段，不是类型清单）", () => {
    const text = serializeConversation(
      [
        { type: "assistant_message", content: "worker 内部正文" },
        { type: "tool_result", callId: "t9", ok: true, output: "worker 内部转录" },
      ] as AgentEvent[],
      2000,
    );
    expect(text).toContain("worker 内部正文");
    expect(text).toContain("worker 内部转录");
  });

  it("两段主流正文中间夹一段子流时不粘连（子流被跳过，父的正文边界照旧收束）", () => {
    const text = serializeConversation(
      [
        { type: "assistant_delta", callId: "m1", text: "前半句" },
        ...child,
        { type: "assistant_delta", callId: "m1", text: "后半句" },
      ] as AgentEvent[],
      2000,
    );
    const assistantLines = text.split("\n").filter((l) => l.startsWith("[Assistant]"));
    expect(assistantLines.length).toBeGreaterThan(0);
    expect(assistantLines.some((l) => l.includes("前半句后半句"))).toBe(false);
  });
});
