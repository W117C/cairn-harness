// M1d 验收脚本（任务书任务 4/5/6 + 反向验证钩子）：长会话模拟 + 手动入口 + 三闸/降级链 + 暗卷。
// 用法：pnpm compaction-check；退出码 0 = 全绿。判卷文件 sha256 冻结校验前置。
// 产物（200k 级事件流 JSONL）写系统临时目录，仓库零污染。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventLog, replay, type AgentEvent } from "../src/events";
import { projectContext, summaryEnvelope } from "../src/agent/context";
import {
  DEFAULT_COMPACTION_CONFIG,
  calibrateFactor,
  CompactionCoordinator,
  compactionCardPayload,
  createMockSummarizer,
  estimateContextTokens,
  estimateTokens,
  keepFirstSet,
  runCompaction,
  shouldCompact,
} from "../src/agent/compaction";
import { createGlmSummarizer } from "../src/agent/glm-session";
import { sha256MatchesFrozen } from "../src/frozen";

const GOAL_KEYWORD = "重构 todo 应用的排序功能";
const ROOT = process.cwd();
const CANARY = "CANARY-被压缩段-原文不得出现在压缩后投影";

let failed = 0;
/** H-2：未证项（前提不成立、断言无从谈起的场景）——显式记账并上报，绝不静默算绿。 */
const unverified: string[] = [];
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log("  \u2705 " + name);
  } catch (err) {
    failed++;
    console.log("  \u274c " + name);
    console.log("     " + (err instanceof Error ? err.message : String(err)));
  }
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const say = (content: string): AgentEvent => ({ type: "assistant_message", content });
const call = (id: string, name: string, args: Record<string, unknown>): AgentEvent => ({ type: "tool_call", id, name, args });
const result = (callId: string, output: string): AgentEvent => ({ type: "tool_result", callId, ok: true, output });

const FROZEN_SUMMARY_1 = [
  "## Objective",
  "- " + GOAL_KEYWORD + "：排序未过滤 done 项，需要改 completedCount 并补测试。",
  "",
  "## Important Details",
  "- 权限 auto 档；测试命令 pnpm test；涉及 fixtures/todo-app/src/todo.ts。",
  "",
  "## Work State",
  "### Completed",
  "- 前半程文件探查与排序函数定位完成。",
  "### Active",
  "- 正在改 completedCount。",
  "### Blocked",
  "- 无。",
  "",
  "## Next Move",
  "- 改完跑 pnpm test 验证。",
  "",
  "## Relevant Files",
  "- fixtures/todo-app/src/todo.ts（写）",
  "- fixtures/todo-app/tests/todo.test.ts（读）",
].join("\n");

const FROZEN_SUMMARY_2 = [
  "## Objective",
  "- " + GOAL_KEYWORD + "（滚动合并：上一份摘要已整合，旧内容不带走即丢失）。",
  "## Important Details",
  "- 测试命令 pnpm test；todo.ts 改到一半。",
  "## Work State",
  "### Completed",
  "- 前半程 + 中段探查完成。",
  "### Active",
  "- completedCount 修改中。",
  "### Blocked",
  "- 无。",
  "## Next Move",
  "- 跑 pnpm test。",
  "## Relevant Files",
  "- fixtures/todo-app/src/todo.ts（写）",
].join("\n");

/** 200k 级长会话：目标 + plan 对 + N 轮探查（大 tool_result）+ 零散 usage / 中段 user 消息。 */
function buildLongSession(rounds: number): AgentEvent[] {
  const events: AgentEvent[] = [user("任务：" + GOAL_KEYWORD)];
  events.push({ type: "plan_proposed", callId: "p1", plan: { goal: GOAL_KEYWORD, files: [{ path: "fixtures/todo-app/src/todo.ts", action: "edit", summary: "排序过滤 done" }] } });
  events.push({ type: "plan_approved", callId: "p1", approved: true });
  let seq = 0;
  for (let i = 0; i < rounds; i++) {
    events.push(say("第 " + i + " 轮：继续探查与修改。"));
    events.push(call("c" + i, "read_file", { path: i % 3 === 0 ? "fixtures/todo-app/src/todo.ts" : "fixtures/todo-app/tests/todo.test.ts" }));
    const body = "round-" + i + " " + "x".repeat(1400);
    events.push(result("c" + i, i === 10 ? CANARY + " " + body : body));
    if (i % 40 === 39) events.push({ type: "usage", inputTokens: 5000 + i, outputTokens: 120 });
    if (i === 250) events.push(user("中段补充：注意边界情况。"));
    seq = i;
  }
  events.push(say("收尾轮 " + seq + "。"));
  return events;
}

let dir: string;

async function main(): Promise<void> {
  console.log("[compaction-check] 判卷文件冻结校验");
  const frozen = await sha256MatchesFrozen(ROOT);
  assert(frozen.ok, "判卷文件 sha256 与冻结基线不一致: " + (frozen.broken ?? "?"));
  console.log("  \u2705 判卷文件 sha256 = 冻结基线");

  dir = await mkdtemp(join(tmpdir(), "m1d-compaction-"));
  try {
    console.log("[compaction-check] 任务 5：200k 级长会话模拟（mock 摘要器明卷）");
    await check("长会话：压缩触发（比例条件 A）且产出 compaction 事件", async () => {
      const events = buildLongSession(500);
      const logPath = join(dir, "long.jsonl");
      const log = createEventLog(logPath);
      for (const e of events) await log.append(e);
      const all = await replay(logPath);
      const factor = calibrateFactor(all);
      const est = estimateContextTokens(projectContext(all), { systemChars: 4000, toolSchemaChars: 6000 }, factor);
      const config = { ...DEFAULT_COMPACTION_CONFIG, inputLimit: est + 20_000, maxOutputReserve: 8_192 };
      const decision = shouldCompact(est, config);
      assert(decision !== null, "估算 " + est + " 未触发（可用 " + (config.inputLimit - config.maxOutputReserve) + "）");
      assert(decision && decision.trigger === "auto" && decision.reason === "threshold", "触发类型错误: " + JSON.stringify(decision));
      const outcome = await runCompaction({
        events: all, trigger: "manual", reason: "user_request",
        summarizer: createMockSummarizer(FROZEN_SUMMARY_1), config,
        overhead: { systemChars: 4000, toolSchemaChars: 6000 },
      });
      assert(outcome.ok, "压缩被拒: " + (!outcome.ok ? outcome.why : ""));
      if (!outcome.ok) return;
      await log.append(outcome.event);
      (globalThis as { __long?: { all: AgentEvent[]; event: typeof outcome.event } }).__long = { all, event: outcome.event };
    });
    await check("长会话①：摘要文本含原始目标关键词（不是把原文塞回去的假压缩）", () => {
      const st = state();
      assert(st.event.summary.includes(GOAL_KEYWORD), "摘要缺目标关键词");
      const full = JSON.stringify(st.all);
      assert(!st.event.summary.includes(CANARY), "摘要含压缩段原文（假压缩嫌疑）");
      assert(full.includes(CANARY), "事件流不含 canary（原始数据必须留存）");
    });
    await check("长会话②：tail 长度落在 clamp(可用×0.25, 2k, 15k) 区间", () => {
      const st = state();
      const offset = st.event.summary_offset;
      const factor = calibrateFactor(st.all); // 与切点同一校准口径（生产函数）
      let tail = 0;
      st.all.forEach((e, i) => {
        if (i + 1 >= offset) tail += estimateTokens(JSON.stringify(e).length, factor);
      });
      assert(tail <= 15_000, "tail " + tail + " 超上界 15000");
      assert(tail >= 2_000, "tail " + tail + " 低于下界 2000");
    });
    await check("长会话③：compressed_event_ids 不含固定回注名单（用户目标/当前 plan）", () => {
      const st = state();
      const kf = keepFirstSet(st.all);
      assert(kf.has(1), "用户目标未被识别为 keep-first");
      for (const id of st.event.compressed_event_ids) assert(!kf.has(id), "keep-first 事件 " + id + " 被压缩");
      // 原为 `includes(4) === false || !kf.has(4)`：实测 **kf={1,2,3,763} 不含 4** → 恒为 `A || true`，
      // 这道门**从未测过任何东西**（H-1 析取式弱断言的典型形态）。
      // 根因是**指错了 id**：eventIdAt(i)=i+1，fixture 里 plan_proposed/plan_approved 在 index 1/2 →
      // **id 2/3**；而 id 4 是第 0 轮的 assistant 消息（say），根本不是 plan。keepFirstSet 本身没问题。
      // 改为对真实 plan 事件断言（按类型推导，不硬编码 id）；「plan 不被压缩」由上面
      // 「compressed ∩ kf = ∅」那条保证，无需重复。
      const planIds = st.all
        .map((e, i) => (e.type === "plan_proposed" || e.type === "plan_approved" ? i + 1 : -1))
        .filter((id) => id > 0);
      assert(planIds.length >= 2, "fixture 应含 plan_proposed 与 plan_approved（实得 " + planIds.length + " 个）");
      for (const id of planIds) assert(kf.has(id), "plan 事件 " + id + " 未被识别为 keep-first");
    });
    await check("长会话④：fresh start 投影（摘要注入 + 被压内容不可见）且重放投影 === 活投影、幂等", async () => {
      const st = state();
      const logPath = join(dir, "long.jsonl");
      await writeFile(logPath, [...st.all, st.event].map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
      const fromDisk = await replay(logPath);
      const live = projectContext([...st.all, st.event]); // 活会话 = 原始流 + 刚落的 compaction 事件
      expectEqual(live, projectContext(fromDisk), "重放投影 !== 活会话投影");
      expectEqual(live, projectContext([...st.all, st.event]), "投影不幂等");
      const text = JSON.stringify(live);
      assert(text.includes(summaryEnvelope(st.event.summary).slice(0, 60)), "摘要未以 user 角色注入");
      assert(!text.includes(CANARY), "被压段 canary 仍可见（fresh start 破坏）");
      const goalVisible = live.some((m) => m.role === "user" && typeof m.content === "string" && m.content.includes(GOAL_KEYWORD));
      assert(goalVisible, "固定回注名单（用户目标）未重注");
    });
    await check("长会话⑤：第二次压缩滚动合并——旧 compaction 事件永不被吞、旧摘要不再注入", async () => {
      const st = state();
      const logPath = join(dir, "long2.jsonl");
      const log = createEventLog(logPath);
      const compactionId = st.all.length + 1; // 追加后的行号
      for (const e of st.all) await log.append(e);
      await log.append(st.event);
      for (let i = 0; i < 60; i++) {
        await log.append(say("二轮 " + i));
        await log.append(call("d" + i, "read_file", { path: "src/f" + i + ".ts" }));
        await log.append(result("d" + i, "round2-" + i + " " + "y".repeat(1400)));
      }
      const all2 = await replay(logPath);
      const config = { ...DEFAULT_COMPACTION_CONFIG, inputLimit: 400_000, maxOutputReserve: 8_192 };
      const outcome = await runCompaction({
        events: all2, trigger: "auto", reason: "threshold",
        summarizer: createMockSummarizer(FROZEN_SUMMARY_2), config,
      });
      assert(outcome.ok, "第二次压缩被拒: " + (!outcome.ok ? outcome.why : ""));
      if (!outcome.ok) return;
      assert(!outcome.event.compressed_event_ids.includes(compactionId), "旧 compaction 事件 " + compactionId + " 被新压缩吞掉");
      await log.append(outcome.event);
      const proj = projectContext(await replay(logPath));
      const text = JSON.stringify(proj);
      assert(text.includes(summaryEnvelope(outcome.event.summary).slice(0, 60)), "新摘要未注入");
      assert(!text.includes(FROZEN_SUMMARY_1.slice(0, 40)), "旧摘要仍单独可见（应被滚动整合）");
    });

    console.log("[compaction-check] 任务 4：/compact 手动入口 + 压缩卡 payload");
    await check("手动触发产生 trigger=manual 事件且卡 payload 字段齐全", async () => {
      const events: AgentEvent[] = [
        user("小会话目标：验证手动压缩。"),
        say("开始。"),
        call("m1", "read_file", { path: "src/a.ts" }),
        result("m1", "z".repeat(800)),
        say("完成。"),
      ];
      const outcome = await runCompaction({
        events, trigger: "manual", reason: "user_request",
        summarizer: createMockSummarizer(FROZEN_SUMMARY_1),
        config: { ...DEFAULT_COMPACTION_CONFIG, inputLimit: 1000, maxOutputReserve: 100, tailMinTokens: 50, tailMaxTokens: 200 },
      });
      assert(outcome.ok, "手动压缩失败: " + (!outcome.ok ? outcome.why : ""));
      if (!outcome.ok) return;
      assert(outcome.event.trigger === "manual", "trigger 不是 manual");
      assert(outcome.event.reason === "user_request", "reason 不是 user_request");
      const p = compactionCardPayload(outcome.event);
      for (const k of ["type", "trigger", "reason", "compressedCount", "compressedRange", "tokensBefore", "tokensAfter", "savedTokens", "summaryPreview"]) {
        assert(p[k as string] !== undefined, "卡 payload 缺字段: " + k);
      }
      assert(p.trigger === "manual", "卡 payload 触发方式不符");
    });

    console.log("[compaction-check] 任务 3：质量闸三件套 + 降级链");
    const gateEvents: AgentEvent[] = [
      user("目标。"),
      say("开始。"),
      call("g1", "read_file", { path: "src/a.ts" }),
      result("g1", "w".repeat(800)),
      call("g2", "write_file", { path: "src/a.ts", content: "b" }),
      result("g2", "done"),
      say("完成。"),
    ];
    const gateConfig = { ...DEFAULT_COMPACTION_CONFIG, inputLimit: 1000, maxOutputReserve: 100, tailMinTokens: 50, tailMaxTokens: 200, retryBackoffMs: 1 };
    await check("质量闸①：空摘要拒绝，不落流", async () => {
      const outcome = await runCompaction({ events: gateEvents, trigger: "auto", reason: "threshold", summarizer: createMockSummarizer("   "), config: gateConfig });
      assert(!outcome.ok && outcome.kind === "rejected" && outcome.why.includes("空摘要"), "应拒绝空摘要: " + JSON.stringify(outcome));
    });
    await check("【反向验证钩子】质量闸②：膨胀拒绝（tokens_after ≥ tokens_before）——本闸被摘除时此断言变红", async () => {
      const outcome = await runCompaction({ events: gateEvents, trigger: "auto", reason: "threshold", summarizer: createMockSummarizer("长".repeat(2400)), config: gateConfig });
      assert(!outcome.ok, "膨胀摘要未被拒绝（膨胀闸失效？）outcome=" + JSON.stringify(outcome).slice(0, 160));
      if (!outcome.ok) assert(outcome.why.includes("膨胀"), "拒绝原因不是膨胀: " + outcome.why);
    });
    await check("质量闸③：最小进度拒绝（被压 < 可见×0.1）", async () => {
      const outcome = await runCompaction({ events: gateEvents, trigger: "auto", reason: "threshold", summarizer: createMockSummarizer(FROZEN_SUMMARY_1), config: { ...gateConfig, minProgress: 0.9 } });
      assert(!outcome.ok && outcome.kind === "rejected" && outcome.why.includes("最小进度"), "应拒绝无效压缩: " + JSON.stringify(outcome));
    });
    await check("降级链：失败退避重试 1 次；连续 2 败停用摘要（auto 跳过、overflow 截断照走）", async () => {
      let calls = 0;
      const coordinator = new CompactionCoordinator({
        summarizer: async () => { calls++; throw new Error("boom"); },
        config: { ...gateConfig },
      });
      const d = { trigger: "auto" as const, reason: "threshold" as const };
      const r1 = await coordinator.maybeCompact(gateEvents, d);
      assert(r1 && !r1.ok && r1.kind === "failed", "第 1 次应 failed: " + JSON.stringify(r1));
      assert(calls === 2, "应重试 1 次（共 2 调用），实际 " + calls);
      await coordinator.maybeCompact(gateEvents, d);
      assert(coordinator.summarizerDisabled, "连续 2 败未停用");
      const r3 = await coordinator.maybeCompact(gateEvents, d);
      assert(r3 === null, "停用后 auto 仍尝试");
      assert(calls === 4, "停用后摘要器不应再被调");
      const r4 = await coordinator.maybeCompact(gateEvents, { trigger: "overflow", reason: "hard_buffer" });
      assert(r4 && r4.ok, "停用后 overflow 紧急截断应照走");
    });
    await check("overflow 紧急：半分截断兜底（不调摘要器、keep-first 与最近 user 保留、必省 token）", async () => {
      let summarizerCalls = 0;
      const events: AgentEvent[] = [user("目标。")];
      for (let i = 0; i < 6; i++) {
        events.push(call("t" + i, "read_file", { path: "f" + i + ".ts" }));
        events.push(result("t" + i, "r" + i));
      }
      events.push(user("最新指令。"));
      events.push(say("收尾。"));
      const coordinator = new CompactionCoordinator({
        summarizer: async () => { summarizerCalls++; return { text: FROZEN_SUMMARY_1 }; },
      });
      const outcome = await coordinator.maybeCompact(events, { trigger: "overflow", reason: "hard_buffer" });
      assert(outcome && outcome.ok, "overflow 截断失败: " + JSON.stringify(outcome));
      if (!outcome || !outcome.ok) return;
      assert(summarizerCalls === 0, "紧急路径不应调摘要器");
      assert(outcome.event.trigger === "overflow", "trigger 应为 overflow");
      assert(outcome.event.compressed_event_ids.length >= 6, "半分截断应摘除约一半");
      const kf = keepFirstSet(events);
      for (const id of outcome.event.compressed_event_ids) assert(!kf.has(id), "keep-first 被截断");
      assert(outcome.event.tokens_after < outcome.event.tokens_before, "截断未省 token");
      // M2g 修正（闭合 §1.4-6）：旧版 `shouldCompact(...) === null || true` 是伪装成断言的恒真式。
      // 改成真断言：给一个足够宽的预算，截断后的估算必须落到阈值以下（shouldCompact → null）。
      const cfg2 = {
        ...DEFAULT_COMPACTION_CONFIG,
        inputLimit: outcome.event.tokens_after * 2 + DEFAULT_COMPACTION_CONFIG.maxOutputReserve,
      };
      assert(
        shouldCompact(outcome.event.tokens_after, cfg2) === null,
        "截断后估算 < 可用预算 × ratio → 不再触发（shouldCompact = null，tokens_after=" + String(outcome.event.tokens_after) + "）",
      );
    });

    console.log("[compaction-check] 任务 6：暗卷（真实 GLM）");
    if (!process.env.CAIRN_API_KEY) {
      // H2（审查 P1-16）：暗卷跳过必须计入未证——unverified 恒空 = 永远 UNVERIFIED=0 = 系统性低报。
      unverified.push("任务 6 暗卷：真实 GLM 摘要（无 CAIRN_API_KEY，跳过）");
      console.log("  暗卷跳过（无 CAIRN_API_KEY）");
    } else {
      await check("暗卷：真实 GLM 摘要非空、未膨胀、最小进度达标", async () => {
        const events: AgentEvent[] = [user("任务：" + GOAL_KEYWORD)];
        for (let i = 0; i < 12; i++) {
          events.push(say("第 " + i + " 轮讨论。"));
          events.push(call("k" + i, "read_file", { path: "src/k" + i + ".ts" }));
          events.push(result("k" + i, "内容 " + i + "：排序函数 " + "细节".repeat(300)));
        }
        events.push(say("收尾。"));
        const outcome = await runCompaction({
          events, trigger: "auto", reason: "threshold",
          summarizer: createGlmSummarizer(),
          config: { ...DEFAULT_COMPACTION_CONFIG, inputLimit: 1000, maxOutputReserve: 100, tailMinTokens: 50, tailMaxTokens: 200 },
          overhead: { systemChars: 3000 },
        });
        assert(outcome.ok, "暗卷压缩失败: " + (!outcome.ok ? outcome.why : ""));
        if (!outcome.ok) return;
        assert(outcome.event.summary.trim().length > 0, "GLM 摘要为空");
        assert(outcome.event.tokens_after < outcome.event.tokens_before, "暗卷膨胀");
        assert(outcome.event.compressed_event_ids.length >= events.length * 0.1, "暗卷最小进度不足");
        console.log("     GLM 摘要 " + outcome.event.summary.length + " chars，" + (outcome.event.tokens_before) + "→" + (outcome.event.tokens_after) + " tokens");
      });
    }

    // 机器可读标记（H-2）：让 pnpm gates 能把未证数上浮到汇总与严格模式判定。
    console.log("UNVERIFIED=" + String(unverified.length));
    if (unverified.length > 0) {
      console.log("[compaction-check] 未证项（前提不成立、断言无从谈起——不等于通过）：");
      for (const u of unverified) console.log("  ⚠️  " + u);
    }
    console.log(
      "[compaction-check] " +
        (failed === 0
          ? unverified.length > 0
            ? "断言全过，但有 " + unverified.length + " 项未证（不得宣称全绿）"
            : "全部断言通过"
          : failed + " 项失败"),
    );
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}


function expectEqual(a: unknown, b: unknown, msg: string): void {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(msg + "（长度 " + ja.length + " vs " + jb.length + "）");
}

interface LongState { all: AgentEvent[]; event: Extract<Awaited<ReturnType<typeof runCompaction>>, { ok: true }>["event"] }
function state(): LongState {
  const s = (globalThis as { __long?: LongState }).__long;
  if (!s) throw new Error("长会话状态缺失（前序断言失败）");
  return s;
}

main().catch((err) => {
  console.error("[compaction-check] 异常退出:", err);
  process.exitCode = 1;
});
