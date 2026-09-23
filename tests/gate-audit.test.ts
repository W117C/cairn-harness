// 权限判定留痕（方案 docs/judgment-layer-calibration-proposal.md §5）。
// 病灶实测（同页 §3）：285 次 tool_call / 99 条受管调用里 `tool_result.auto` 留痕 **0 条**，
// 且 approval 只有 worker 侧落流 ⇒「当时判了什么、人怎么答的」事后完全读不出。
// 本文件锁三件事：① 每个出口自报判据层；② auto 由 gate 派生（原语义一字不改）；
// ③ 被拦/被拒的调用不得再被计成"工具失败"（那是 tool-choice 现在的假红来源）。
import { describe, expect, it } from "vitest";
import {
  autoOf,
  evaluate,
  GATE_LAYERS,
  gateBase,
  newAutonomySession,
  scopeKey,
  type AutonomySession,
  type GateLayer,
  type GateMeta,
  type PermissionRule,
} from "../src/permissions";
import { runLoop } from "../src/agent/loop";
import { DISTILL_GATE } from "../src/agent/memory/distill";
import { projectSession } from "../src/agent/tool-choice";
import type { AgentEvent, ToolResultEvent } from "../src/events";
import type { ModelOutput, Provider } from "../src/providers";
import type { Tool } from "../src/tools";

function session(init: Partial<AutonomySession> = {}): AutonomySession {
  const s = newAutonomySession(init.mode ?? "auto", {
    rules: init.rules ?? [],
    sandboxAvailable: init.sandboxAvailable ?? null,
    sessionScopes: (init.sessionScopes as Set<string>) ?? new Set<string>(),
    frozenJudgePaths: (init.frozenJudgePaths as Set<string>) ?? new Set<string>(),
  });
  s.planBlocked = init.planBlocked ?? (() => false);
  return s;
}

const rule = (r: Partial<PermissionRule>): PermissionRule => ({
  behavior: r.behavior ?? "allow",
  tool: r.tool ?? "run_shell",
  pattern: r.pattern,
  scope: "always",
  id: r.id,
});

const JUDGE = "tests/todo.test.ts";

/** 每个出口 → 期望的判据层。加一层不往这张表里写用例，最后那条穷尽断言就红。 */
const LAYER_CASES: readonly { name: string; expected: GateLayer; run: () => unknown }[] = [
  { name: "只读档摘除写向工具", expected: "L0-hard", run: () => evaluate("write_file", { path: "a.ts" }, session({ mode: "read-only" })) },
  { name: "方案门未批即写禁", expected: "L0-hard", run: () => evaluate("write_file", { path: "a.ts" }, session({ mode: "auto", planBlocked: () => true })) },
  { name: "判卷文件冻结", expected: "L0-hard", run: () => evaluate("write_file", { path: JUDGE }, session({ mode: "auto", frozenJudgePaths: new Set([JUDGE]) })) },
  { name: "deny 规则命中", expected: "L1-deny", run: () => evaluate("run_shell", { command: "rm x.txt" }, session({ mode: "auto", rules: [rule({ behavior: "deny", pattern: "rm" })] })) },
  { name: "ask 规则命中", expected: "L2-ask-rule", run: () => evaluate("run_shell", { command: "git push origin" }, session({ mode: "auto", rules: [rule({ behavior: "ask", pattern: "git push" })] })) },
  { name: "allow 规则放行", expected: "L3-rule", run: () => evaluate("run_shell", { command: "pnpm lint" }, session({ mode: "auto", rules: [rule({ behavior: "allow", pattern: "pnpm lint" })] })) },
  { name: "session_kind 记忆放行", expected: "L3-scope", run: () => evaluate("run_shell", { command: "pnpm test" }, session({ mode: "default", sessionScopes: new Set([scopeKey("run_shell", { command: "pnpm test" })]) })) },
  { name: "默认档写向逐次审批", expected: "L3-mode", run: () => evaluate("write_file", { path: "a.ts" }, session({ mode: "default" })) },
  { name: "allow 规则批不掉 critical", expected: "L4-critical", run: () => evaluate("run_shell", { command: "rm -rf /" }, session({ mode: "auto", rules: [rule({ behavior: "allow", pattern: "rm" })] })) },
  { name: "critical 任何档强制审批", expected: "L4-critical", run: () => evaluate("run_shell", { command: "rm -rf ~" }, session({ mode: "auto" })) },
  { name: "自主档 risk≥high 送审", expected: "L4-risk", run: () => evaluate("run_shell", { command: "rm -rf build" }, session({ mode: "auto" })) },
  { name: "非自主档 risk≥high 送审", expected: "L4-risk", run: () => evaluate("read_file", { path: "a.ts", requires_approval: true }, session({ mode: "default" })) },
  { name: "MCP 无注解按写 fail-closed", expected: "L4-mcp-unannotated", run: () => evaluate("mcp__srv__do" as never, {}, session({ mode: "auto" })) },
  { name: "自主档网络类 risk≥medium 送审", expected: "L4-network", run: () => evaluate("run_shell", { command: "curl http://api.example.com" }, session({ mode: "auto" })) },
  { name: "自主档末行放行（今天零痕迹的那条）", expected: "L4-pass", run: () => evaluate("run_shell", { command: "echo hi" }, session({ mode: "auto" })) },
  // `X-distill`：沉淀轮那三类判定不在 `evaluate` 里发生，因此这里钉的是**它的登记形状**（层名单列、
  // 三型不塌成一格）；真发出去的那份留痕由 `tests/distill.test.ts` 从真入口判。
  { name: "沉淀轮结局（判定在 evaluate 之外）", expected: "X-distill", run: () => DISTILL_GATE.unapproved },
];

describe("evaluate 的每个出口自报判据层", () => {
  for (const c of LAYER_CASES) {
    it(`${c.name} ⇒ layer=${c.expected}`, () => {
      expect(c.run()).toMatchObject({ layer: c.expected });
    });
  }

  it("穷尽：GATE_LAYERS 里每层都有用例（新增层不许没有判据）", () => {
    const covered = new Set(LAYER_CASES.map((c) => c.expected));
    expect(GATE_LAYERS.filter((l) => !covered.has(l))).toEqual([]);
  });

  it("gateBase 的产物必带 mode（`X-` 面才允许缺）", () => {
    // `mode` 从必填放宽成可选是为了 `X-distill`（那一轮不受档位机管辖）。放宽的代价是
    // "evaluate 侧漏填 mode" 不再有编译期信号 ⇒ 这条把它换回运行时判据：构造口是唯一 writer，
    // 它的产物少 mode = 全部出口的档位一起消失，按档算的免批率/ECE 会静默失真。
    const base = gateBase({ verdict: "approve", layer: "L4-pass", risk: "none" }, "guided");
    expect(base.mode).toBe("guided");
    expect(base.layer).toBe("L4-pass");
    // 反向一侧：`X-` 面**就是**不带档位——带上就把不受档位管的量算进那一档的分母了
    expect(DISTILL_GATE.unapproved).not.toHaveProperty("mode");
  });

  it("deny 出口也带 layer（被拦的调用同样要能回放是谁拦的）", () => {
    const d = evaluate("write_file", { path: "a.ts" }, session({ mode: "read-only" })) as { verdict: string; layer?: GateLayer };
    expect(d.verdict).toBe("deny");
    expect(d.layer).toBe("L0-hard");
  });
});

describe("gateBase：三处出口（主会话 / MCP / worker）共用的留痕构造器", () => {
  it("从判定结果带出 layer / risk / mode，allow 规则命中时带出 ruleId", () => {
    const s = session({ mode: "auto", rules: [rule({ behavior: "allow", pattern: "pnpm lint", id: "allow:run_shell:pnpm lint#7" })] });
    const base = gateBase(evaluate("run_shell", { command: "pnpm lint" }, s), "auto");
    expect(base).toEqual({ layer: "L3-rule", risk: "none", mode: "auto", ruleId: "allow:run_shell:pnpm lint#7" });
  });

  it("不自造 verdict：拒绝还是放行由持有审批结果的那一侧填", () => {
    const base = gateBase(evaluate("write_file", { path: "a.ts" }, session({ mode: "read-only" })), "read-only");
    expect("verdict" in base).toBe(false);
    expect(base.layer).toBe("L0-hard");
  });

  it("非自动放行的判定不带 ruleId（缺席而不是空串）", () => {
    const base = gateBase(evaluate("run_shell", { command: "rm x.txt" }, session({ mode: "auto" })), "auto");
    expect("ruleId" in base).toBe(false);
  });
});

describe("autoOf：auto 从 gate 派生，原语义一字不改", () => {
  const g = (over: Partial<GateMeta>): GateMeta => ({
    layer: "L4-pass", verdict: "auto-approved", risk: "none", mode: "auto", ...over,
  });

  it("L3-rule 自动放行 ⇒ auto{source:rule, ruleId}（§11.7.5 原形状）", () => {
    expect(autoOf(g({ layer: "L3-rule", ruleId: "allow:run_shell:pnpm lint#1" })))
      .toEqual({ source: "rule", ruleId: "allow:run_shell:pnpm lint#1" });
  });

  it("L3-scope 自动放行 ⇒ auto{source:session_scope, ruleId=scopeKey}", () => {
    expect(autoOf(g({ layer: "L3-scope", ruleId: "run_shell\u241Fpnpm test" })))
      .toEqual({ source: "session_scope", ruleId: "run_shell\u241Fpnpm test" });
  });

  it("人工批准不产生 auto（原契约由代码保证，不再靠各出口自觉）", () => {
    expect(autoOf(g({ layer: "L3-mode", verdict: "approved", scope: "once" }))).toBeUndefined();
  });

  it("末行放行不产生 auto（留痕走 gate，auto 只记 rule|session_scope）", () => {
    expect(autoOf(g({ layer: "L4-pass" }))).toBeUndefined();
  });

  it("拒绝 / 超时 / 无人值守 / deny 都不产生 auto", () => {
    for (const verdict of ["rejected", "timeout", "unattended", "denied"] as const) {
      expect(autoOf(g({ layer: "L1-deny", verdict }))).toBeUndefined();
    }
  });
});

/** 单轮 runLoop：脚本吐一次 tool_call，再吐一条无调用的消息收束。 */
async function runOneTool(result: Record<string, unknown>, name = "run_shell"): Promise<AgentEvent[]> {
  const log: AgentEvent[] = [];
  const call = { type: "tool_call", id: "c1", name, args: { command: "echo hi" } } as unknown as ModelOutput;
  const done = { type: "assistant_message", content: "完了" } as unknown as ModelOutput;
  let step = 0;
  const provider: Provider = {
    async *stream() {
      yield step++ === 0 ? call : done;
    },
  };
  const tool: Tool = { name, run: async () => result as never };
  await runLoop({
    provider,
    events: { async append(e) { log.push(e); } },
    workspace: "/tmp",
    userMessage: "跑一下",
    mode: "auto",
    tools: { [name]: tool },
  });
  return log;
}

const resultEvent = (log: AgentEvent[]): ToolResultEvent =>
  log.filter((e) => e.type === "tool_result").at(-1) as ToolResultEvent;

describe("loop 把 gate 写进 tool_result，并从 gate 派生 auto", () => {
  it("自动放行：gate 在场且 auto 由它派生", async () => {
    const log = await runOneTool({
      ok: true, output: "hi",
      gate: { layer: "L3-rule", verdict: "auto-approved", risk: "none", mode: "auto", ruleId: "allow:run_shell#1" },
    });
    const e = resultEvent(log);
    expect(e.gate).toMatchObject({ layer: "L3-rule", verdict: "auto-approved" });
    expect(e.auto).toEqual({ source: "rule", ruleId: "allow:run_shell#1" });
  });

  it("人工批准后执行：gate 在场、auto 缺席", async () => {
    const log = await runOneTool({
      ok: true, output: "hi",
      gate: { layer: "L3-mode", verdict: "approved", risk: "medium", mode: "default", scope: "session_kind" },
    });
    const e = resultEvent(log);
    expect(e.gate).toMatchObject({ layer: "L3-mode", verdict: "approved", scope: "session_kind" });
    expect(e.auto).toBeUndefined();
  });

  it("无人值守自动拒绝：gate.verdict=unattended 落流（今天的黑面，拒批原因不可回放）", async () => {
    const log = await runOneTool({
      ok: false, output: "[permission denied] run_shell 在 default 档下被门拒绝（未获批准）",
      gate: { layer: "L3-mode", verdict: "unattended", risk: "medium", mode: "default" },
    });
    expect(resultEvent(log).gate).toMatchObject({ verdict: "unattended", layer: "L3-mode" });
  });

  it("无 gate 的工具（非受管面）不凭空造 auto/gate 字段", async () => {
    const e = resultEvent(await runOneTool({ ok: true, output: "hi" }));
    expect(e.gate).toBeUndefined();
    expect(e.auto).toBeUndefined();
  });
});

describe("留痕不被计成工具失败（tool-choice 的 failures 口径）", () => {
  const pair = (result: Partial<ToolResultEvent>): AgentEvent[] => [
    { type: "tool_call", id: "c1", name: "run_shell", args: { command: "echo hi" } },
    { type: "tool_result", callId: "c1", ok: false, output: "[permission denied] ...", ...result },
  ] as AgentEvent[];

  it("权限拒绝（gate 在场）不计入 byToolName.failures", () => {
    const s = projectSession(pair({
      gate: { layer: "L1-deny", verdict: "denied", risk: "high", mode: "auto" },
    }));
    expect(s.byToolName.run_shell?.failures).toBe(0);
    expect(s.byToolName.run_shell?.calls).toBe(1);
  });

  it("反向对照：真工具失败（无 gate）仍计入 failures", () => {
    const s = projectSession(pair({}));
    expect(s.byToolName.run_shell?.failures).toBe(1);
  });
});
