// 压缩摘要里的「## Tried & Rejected」：长任务压过一次之后，「这条路我已经走过、它红了」不能只靠模型愿意写。
// 判卷吃法与仓里同规：合成面把两态各钉一次（有失败必须出声／没失败必须闭嘴），接线面走真 runCompaction 两条出口。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent, VerifyCommandResult } from "../src/events";
import {
  DEFAULT_COMPACTION_CONFIG,
  TRIED_REJECTED_CAPS,
  createMockSummarizer,
  extractTriedRejected,
  runCompaction,
  triedRejectedNote,
} from "../src/agent/compaction";

const GOAL = "修复 todo 应用的排序 bug";
const TINY = { inputLimit: 1000, maxOutputReserve: 100, tailMinTokens: 50, tailMaxTokens: 200, retryBackoffMs: 1 };
const SHORT_SUMMARY = "## Objective\n- " + GOAL + "\n## Work State\n### Active\n- 正在查排序";

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const say = (content: string): AgentEvent => ({ type: "assistant_message", content });
const call = (id: string, name: string, args: Record<string, unknown>): AgentEvent => ({ type: "tool_call", id, name, args });
const ok = (callId: string, output: string): AgentEvent => ({ type: "tool_result", callId, ok: true, output });
const fail = (callId: string, output: string, meta: Record<string, unknown> = {}): AgentEvent =>
  ({ type: "tool_result", callId, ok: false, output, ...meta }) as AgentEvent;
const verifyFail = (results: VerifyCommandResult[], meta: Record<string, unknown> = {}): AgentEvent =>
  ({ type: "verify_result", callId: "v1", ok: false, attempt: 2, maxAttempts: 3, results, ...meta }) as AgentEvent;

describe("extractTriedRejected：两态各钉一次", () => {
  it("零失败的压缩范围 ⇒ 一段都不许多插（宁缺不编，别给摘要添噪声）", () => {
    const clean: AgentEvent[] = [
      user(GOAL),
      call("t1", "read_file", { path: "src/a.ts" }),
      ok("t1", "export const a = 1;"),
      say("读完了"),
    ];
    expect(extractTriedRejected(clean)).toEqual([]);
    expect(triedRejectedNote(clean), "没有可报的 ⇒ 空串，不许插一个空标题").toBe("");
  });

  it("run_shell 红 ⇒ 点名命令原文与退出码（接手者据此不必重抄参数就知道别再试）", () => {
    const evs: AgentEvent[] = [
      user(GOAL),
      call("c1", "run_shell", { command: "npx tsx scripts/gate-check.ts" }),
      fail("c1", "boom\nno such file\n", { exitCode: 1 }),
    ];
    const b = extractTriedRejected(evs);
    expect(b).toHaveLength(1);
    expect(b[0]).toContain("npx tsx scripts/gate-check.ts");
    expect(b[0]).toContain("退出码 1");
  });

  it("verify 红 ⇒ 必须点出**命令原文**与第几次（从前那行只有「失败（第 2/3 次）」，哪条命令红是丢掉的）", () => {
    const b = extractTriedRejected([
      user(GOAL),
      verifyFail([{ command: "node --import tsx scripts/typecheck.ts", ok: false, output: "TS2345: 类型不匹配", cause: "code" }]),
    ]);
    expect(b).toHaveLength(1);
    expect(b[0]).toContain("node --import tsx scripts/typecheck.ts");
    expect(b[0]).toContain("第 2/3 次");
    expect(b[0]).toContain("TS2345");
  });

  it("环境成因要标『别当此路不通』，代码成因不许跟着一起标（两态各一次，防这条判据写成恒真）", () => {
    const env = extractTriedRejected([
      user(GOAL),
      verifyFail([{ command: "pnpm lint", ok: false, output: "pnpm: not found", cause: "toolchain-missing" }]),
    ]);
    const code = extractTriedRejected([
      user(GOAL),
      verifyFail([{ command: "pnpm test", ok: false, output: "1 failed", cause: "code" }]),
    ]);
    expect(env[0]).toContain("别当此路不通");
    expect(code[0], "把每条红都标成环境成因 ⇒ 这一段就再也没人信了").not.toContain("别当此路不通");
  });

  it("同一条失败撞三遍 ⇒ 并成一条并报 ×3（重复撞同一堵墙正是最该带下来的信号）", () => {
    const evs: AgentEvent[] = [
      user(GOAL),
      call("a", "run_shell", { command: "make lint" }), fail("a", "syntax error near line 3\n", { exitCode: 2 }),
      call("b", "run_shell", { command: "make lint" }), fail("b", "syntax error near line 3\n", { exitCode: 2 }),
      call("c", "run_shell", { command: "make lint" }), fail("c", "syntax error near line 3\n", { exitCode: 2 }),
    ];
    const b = extractTriedRejected(evs);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatch(/^×3 /);
  });

  it("超过条数帽 ⇒ 只留帽内条数，尾巴必须出声说还剩几条（分母不许静默）", () => {
    const evs: AgentEvent[] = [user(GOAL)];
    for (let i = 0; i < TRIED_REJECTED_CAPS.bullets + 3; i++) {
      evs.push(call("x" + String(i), "run_shell", { command: "cmd-" + String(i) }));
      evs.push(fail("x" + String(i), "failure number " + String(i), { exitCode: 1 }));
    }
    const b = extractTriedRejected(evs);
    expect(b.filter((x) => !x.startsWith("（压缩范围内另有"))).toHaveLength(TRIED_REJECTED_CAPS.bullets);
    expect(b[b.length - 1]).toContain("另有 3 条未列");
  });

  it("长输出里没有错误行 ⇒ 结构化那半留着、正文不挂（不把 ls 的目录列表当日志塞进摘要）", () => {
    const listing = Array.from({ length: 12 }, (_, i) => "drwxr-xr-x  7 ze staff 224 Oct 1 18:1" + String(i % 10) + " dir" + String(i)).join("\n");
    const noErr = extractTriedRejected([
      user(GOAL),
      call("s1", "run_shell", { command: "ls -la" }), fail("s1", listing, { exitCode: 1 }),
    ]);
    expect(noErr[0]).toContain("失败（退出码 1）");
    expect(noErr[0], "没有错误行时带回来的散文不是失败原因，是抢注意力的噪声").not.toContain("drwx");
    expect(noErr[0]).not.toContain("[尾部]");
    const withErr = extractTriedRejected([
      user(GOAL),
      call("s2", "run_shell", { command: "ls -la" }), fail("s2", listing + "\nfatal: not a git repository\n", { exitCode: 128 }),
    ]);
    expect(withErr[0]).toContain("not a git repository");
  });

  it("未执行（被闸拦下）与跑挂了要长得不一样，且 worker 子流的失败要带归属", () => {
    const blocked = extractTriedRejected([
      user(GOAL),
      call("p1", "write_file", { path: "src/a.ts" }),
      fail("p1", "需要批准\n", { blockedBy: "permission" }),
    ]);
    expect(blocked[0]).toContain("未执行（被 permission 拦）");
    expect(blocked[0]).not.toContain("退出码");
    const child = extractTriedRejected([
      user(GOAL),
      call("w1", "run_shell", { command: "cargo test" }), fail("w1", "error[E0308]: mismatched types\n", { exitCode: 101, agent_id: "worker-3" }),
    ]);
    expect(child[0], "worker 撞的红在主流里被读成父会话撞的 ⇒ 重复派同一个活").toContain("〔worker:worker-3〕");
  });

  it("plan 被拒 ⇒ 带得上提案要点；提案原文不在压缩范围时要明说（不许静默空条目）", () => {
    const withPlan = extractTriedRejected([
      user(GOAL),
      { type: "plan_proposed", callId: "pl1", plan: { goal: GOAL, files: [], approach: "改成稳定排序" } } as AgentEvent,
      { type: "plan_approved", callId: "pl1", approved: false } as AgentEvent,
    ]);
    expect(withPlan).toHaveLength(1);
    expect(withPlan[0]).toContain("改成稳定排序");
    const orphan = extractTriedRejected([
      user(GOAL),
      { type: "plan_approved", callId: "pl9", approved: false } as AgentEvent,
    ]);
    expect(orphan[0]).toContain("提案原文不在压缩范围内");
  });
});

describe("接线：两条压缩出口都真的带这一段", () => {
  // 切点吞的是**最旧**的一段（keep-first 与最近 typed 用户消息除外），所以失败面必须排在前面，
  // 大体积的读文件排在后面当尾巴——否则这一台是在判"范围外的东西没被带进来"，那是另一件事。
  const eventsWithFailure = (): AgentEvent[] => [
    user(GOAL),
    say("开始"),
    call("t1", "run_shell", { command: "pnpm test --sort" }),
    fail("t1", "error: expect(received).toEqual(expected) 排序仍错\n", { exitCode: 1 }),
    verifyFail([{ command: "node scripts/typecheck.ts", ok: false, output: "TS2322 不可赋值", cause: "code" }]),
    call("t2", "read_file", { path: "src/todo.ts" }),
    ok("t2", "z".repeat(2000)),
    user("再验证一次"),
    say("好"),
  ];

  it("常规摘要出口：模型没写这一段 ⇒ harness 补上，且点名的是命令原文", async () => {
    const outcome = await runCompaction({
      events: eventsWithFailure(),
      trigger: "auto",
      reason: "threshold",
      summarizer: createMockSummarizer(SHORT_SUMMARY),
      config: { ...DEFAULT_COMPACTION_CONFIG, ...TINY },
    });
    if (!outcome.ok) throw new Error("压缩没成：" + outcome.why);
    expect(outcome.event.summary).toContain("## Tried & Rejected");
    expect(outcome.event.summary).toContain("pnpm test --sort");
    expect(outcome.event.summary).toContain("node scripts/typecheck.ts");
  });

  it("模型自己写了这一段 ⇒ 逐字不覆盖、也不许多插一份（短路支）", async () => {
    const mine = SHORT_SUMMARY + "\n\n## Tried & Rejected\n- 我自己写的条目";
    const outcome = await runCompaction({
      events: eventsWithFailure(),
      trigger: "auto",
      reason: "threshold",
      summarizer: createMockSummarizer(mine),
      config: { ...DEFAULT_COMPACTION_CONFIG, ...TINY },
    });
    if (!outcome.ok) throw new Error("压缩没成：" + outcome.why);
    expect(outcome.event.summary.split("## Tried & Rejected")).toHaveLength(2);
    expect(outcome.event.summary).toContain("我自己写的条目");
    expect(outcome.event.summary, "有这一段就不该再来一条 harness 版的说明行").not.toContain("非模型转述");
  });

  it("overflow 紧急截断出口也带（长任务快撑不住的那一拍最贵，它原本只剩一句标记）", async () => {
    const outcome = await runCompaction({
      events: eventsWithFailure(),
      trigger: "overflow",
      reason: "hard_buffer",
      config: { ...DEFAULT_COMPACTION_CONFIG, ...TINY },
    });
    if (!outcome.ok) throw new Error("截断没成：" + outcome.why);
    expect(outcome.event.summary).toContain("[overflow 紧急截断]");
    expect(outcome.event.summary).toContain("## Tried & Rejected");
  });
});

describe("真语料面（tracked .jsonl 现读，两向都不许空转）", () => {
  const trackedJsonl = (): string[] =>
    execFileSync("git", ["ls-files", "-z", "--", "fixtures"], { encoding: "utf8" })
      .split("\0").filter((p) => p.endsWith(".jsonl")).sort();

  const eventsOf = (rel: string): AgentEvent[] =>
    readFileSync(join(process.cwd(), rel), "utf8").split("\n").filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as AgentEvent);

  it("有失败面的语料必须出条目、零失败面的必须为空；每条单行且不越帽", () => {
    const files = trackedJsonl();
    expect(files.length, "取料面读到 0 个文件 ⇒ 没有尺，不是通过").toBeGreaterThanOrEqual(30);
    let withFailures = 0;
    for (const rel of files) {
      const evs = eventsOf(rel);
      const bullets = extractTriedRejected(evs);
      const hasFailureFace = evs.some((e) =>
        (e.type === "tool_result" && e.ok === false) ||
        (e.type === "verify_result" && e.ok === false) ||
        (e.type === "plan_approved" && e.approved === false));
      if (hasFailureFace) withFailures += 1;
      expect(bullets.length === 0, rel + "：有失败面却一条都没报 ⇒ 这段尺空转").toBe(!hasFailureFace);
      for (const b of bullets) {
        expect(b, rel + "：条目必须单行（多行会把交接摘要的列表结构打散）").not.toContain("\n");
        // 上界从条目形状推：目标（≤lineChars）＋正文（≤lineChars）＋动词与结构化标签那一截（给 60）。
        expect(b.length, rel + "：单条越界 ⇒ 段长就不再是有界的了").toBeLessThanOrEqual(TRIED_REJECTED_CAPS.lineChars * 2 + 60);
      }
    }
    expect(withFailures, "这批语料里一条失败面都没有 ⇒ 上面两向断言全是空转").toBeGreaterThan(0);
  });
});
