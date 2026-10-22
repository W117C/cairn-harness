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
  // 断路器那一因要能复现：它与「逐次审批」同层（L3-mode），只靠层分不出来。
  if (init.breakerTripped) s.breakerTripped = true;
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

/** 每个出口 → 期望的判据层 + **凭哪一条判据**。加一层不往这张表里写用例，最后那条穷尽断言就红。
 *
 *  为什么加「凭哪一条」这一维（2026-10-22 实测）：`evaluate` 的出口是 **17 处**（`src/permissions/autonomy.ts`
 *  的 17 个 return），而层只有 **12 个** ⇒ 层是好几处因的合流，`L0-hard` 一层就有四因
 *  （只读档摘除／方案门／判卷文件冻结／判卷面取不出目标），四者**结构上完全一样**
 *  （verdict=deny、不带 risk、无 auto），只有散文 reason 不同 ⇒ 只钉层的判据**分不出它们**。
 *  同族缺陷：「只有正例的判据读起来像覆盖、其实证明不了什么」
 *  （Anthropic《Demystifying evals for AI agents》：「One-sided evals create one-sided optimization」；
 *   AG-UI 的 fixture 纪律：「a fixture that cannot fail is worse than no fixture」——
 *   它说这句话的场合正是「一份 fixture 钉不出任何失败」）。
 *  ⇒ 每条用例多钉两样：`cause`（结构化事实：裁决／风险级／命中哪条规则）与
 *  `reasonEquals`/`reasonContains`（生产文案里那一小段**唯一**能分开同层几种因的话，逐字取自生产文案，
 *  由 `scripts/prose-needle-scan.ts` 对账）。少钉的后果是量出来的：**因错而层对**的错案今天照样绿。
 */
const LAYER_CASES: readonly {
  name: string;
  expected: GateLayer;
  /** 结构化的因。字段缺席是**真值**（L0/L1 出口不带 risk），不是漏填。 */
  cause?: { verdict?: string; risk?: string; auto?: { source?: string; ruleId?: string } };
  /** 同层里只有散文能把几种因分开时，钉生产文案里那一小段（逐字）。 */
  reasonEquals?: string;
  reasonContains?: string;
  run: () => unknown;
}[] = [
  { name: "只读档摘除写向工具", expected: "L0-hard", cause: { verdict: "deny" }, reasonEquals: "只读档摘除写向工具", run: () => evaluate("write_file", { path: "a.ts" }, session({ mode: "read-only" })) },
  { name: "方案门未批即写禁", expected: "L0-hard", cause: { verdict: "deny" }, reasonEquals: "方案门：先批后写（当前没有已批准的方案）", run: () => evaluate("write_file", { path: "a.ts" }, session({ mode: "auto", planBlocked: () => true })) },
  { name: "判卷文件冻结", expected: "L0-hard", cause: { verdict: "deny" }, reasonContains: "判卷文件冻结", run: () => evaluate("write_file", { path: JUDGE }, session({ mode: "auto", frozenJudgePaths: new Set([JUDGE]) })) },
  // ★ 第四种 L0 因（原来没有用例）：认不出补丁要写哪儿 ⇒ 按 fail-closed 拒绝。
  // 「读不到目标」不等于「目标安全」——这条闸一软，畸形补丁就成了绕过冻结表的第二道门。
  { name: "判卷面取不出目标：认不出补丁写哪儿 ⇒ fail-closed 拒绝", expected: "L0-hard", cause: { verdict: "deny" }, reasonContains: "判卷面冻结闸没法判", run: () => evaluate("apply_patch", { patch: "这不是 diff" }, session({ mode: "auto", frozenJudgePaths: new Set([JUDGE]) })) },
  { name: "deny 规则命中", expected: "L1-deny", cause: { verdict: "deny" }, reasonContains: "deny 规则命中", run: () => evaluate("run_shell", { command: "rm x.txt" }, session({ mode: "auto", rules: [rule({ behavior: "deny", pattern: "rm" })] })) },
  { name: "ask 规则命中", expected: "L2-ask-rule", cause: { verdict: "ask", risk: "none" }, reasonContains: "ask 规则命中", run: () => evaluate("run_shell", { command: "git push origin" }, session({ mode: "auto", rules: [rule({ behavior: "ask", pattern: "git push" })] })) },
  { name: "allow 规则放行", expected: "L3-rule", cause: { verdict: "approve", risk: "none", auto: { source: "rule", ruleId: "allow:run_shell:pnpm lint#1" } }, run: () => evaluate("run_shell", { command: "pnpm lint" }, session({ mode: "auto", rules: [rule({ behavior: "allow", pattern: "pnpm lint", id: "allow:run_shell:pnpm lint#1" })] })) },
  { name: "session_kind 记忆放行", expected: "L3-scope", cause: { verdict: "approve", risk: "none", auto: { source: "session_scope", ruleId: scopeKey("run_shell", { command: "pnpm test" }) } }, run: () => evaluate("run_shell", { command: "pnpm test" }, session({ mode: "default", sessionScopes: new Set([scopeKey("run_shell", { command: "pnpm test" })]) })) },
  { name: "默认档写向逐次审批", expected: "L3-mode", cause: { verdict: "ask", risk: "none" }, reasonEquals: "默认档逐次审批", run: () => evaluate("write_file", { path: "a.ts" }, session({ mode: "default" })) },
  // ★ 断路器那一因（原来没有用例）：连续自动放行达上限后降级为逐次审批。
  // 与上面那条**同层同 verdict**，只靠层分不出来 ⇒ 分它的是那句「断路器触发」。
  { name: "断路器触发：连续自动放行达上限 ⇒ 降级为逐次审批", expected: "L3-mode", cause: { verdict: "ask", risk: "none" }, reasonContains: "断路器触发", run: () => evaluate("write_file", { path: "a.ts" }, session({ mode: "default", breakerTripped: true })) },
  { name: "allow 规则批不掉 critical", expected: "L4-critical", cause: { verdict: "ask", risk: "critical" }, reasonEquals: "critical 任何档位强制审批（allow 规则不豁免）", run: () => evaluate("run_shell", { command: "rm -rf /" }, session({ mode: "auto", rules: [rule({ behavior: "allow", pattern: "rm" })] })) },
  { name: "critical 任何档强制审批", expected: "L4-critical", cause: { verdict: "ask", risk: "critical" }, reasonEquals: "critical 任何档位强制审批", run: () => evaluate("run_shell", { command: "rm -rf ~" }, session({ mode: "auto" })) },
  { name: "自主档 risk≥high 送审", expected: "L4-risk", cause: { verdict: "ask", risk: "high" }, reasonEquals: "风险≥high 送审（自主档）", run: () => evaluate("run_shell", { command: "rm -rf build" }, session({ mode: "auto" })) },
  { name: "非自主档 risk≥high 送审", expected: "L4-risk", cause: { verdict: "ask", risk: "high" }, reasonEquals: "风险≥high 送审", run: () => evaluate("read_file", { path: "a.ts", requires_approval: true }, session({ mode: "default" })) },
  // ★ 第二种 L4-risk 因（原来没有用例）：裸 allow 规则（「总是允许该工具」）不带走高风险路径。
  // 少了它，一次普通的 write_file 批准会把 .env / .git/hooks 一起免批。
  { name: "裸 allow 规则不带走高风险路径（非 shell）", expected: "L4-risk", cause: { verdict: "ask", risk: "high" }, reasonEquals: "高风险路径不随「总是允许该工具」一起放行：仍需逐次确认", run: () => evaluate("write_file", { path: ".env" }, session({ mode: "auto", rules: [rule({ behavior: "allow", tool: "write_file" })] })) },
  { name: "MCP 无注解按写 fail-closed", expected: "L4-mcp-unannotated", cause: { verdict: "ask", risk: "none" }, reasonEquals: "MCP 无注解：按写处理，自主档亦逐次（§11.7.2 fail-closed）", run: () => evaluate("mcp__srv__do" as never, {}, session({ mode: "auto" })) },
  // M7：未登记工具名与上面那条**同层同裁决**——都属「工具面没为自己作证」，所以复用该层而不是新增一层
  // （新增会在 layer×verdict 矩阵里多出一列，而它在任何真实语料里都恒为 0）。
  // 代价已知：`L4-mcp-unannotated` 的读数此后不再只关于 MCP，两种情形在复跑面上并进同一格。
  // ⇒ 层既然合成一格，「因」就得分开钉：上面那条钉「MCP 无注解」，这条钉「未登记工具名」。
  { name: "未登记工具名按写 fail-closed（M7）", expected: "L4-mcp-unannotated", cause: { verdict: "ask", risk: "none" }, reasonContains: "未登记工具名", run: () => evaluate("never_registered_tool" as never, {}, session({ mode: "auto" })) },
  { name: "自主档网络类 risk≥medium 送审", expected: "L4-network", cause: { verdict: "ask", risk: "medium" }, reasonEquals: "网络类命令 risk≥medium 送审（自主档，出网审计）", run: () => evaluate("run_shell", { command: "curl http://api.example.com" }, session({ mode: "auto" })) },
  { name: "自主档末行放行（今天零痕迹的那条）", expected: "L4-pass", cause: { verdict: "approve", risk: "none" }, run: () => evaluate("run_shell", { command: "echo hi" }, session({ mode: "auto" })) },
  // `X-distill`：沉淀轮的四类判定不在 `evaluate` 里发生，因此这里钉的是**它的登记形状**（层名单列、
  // 四型不塌成一格；`auto` 档=项目层分层免批）；真发出去的那份留痕由 `tests/distill.test.ts` 从真入口判。
  { name: "沉淀轮结局（判定在 evaluate 之外）", expected: "X-distill", cause: { verdict: "rejected" }, run: () => DISTILL_GATE.unapproved },
  // ★ 第三种 X-distill 结局（原来没有用例）：已批那一支与上面两支同层，只靠层分不出来。
  { name: "沉淀轮已批（判定在 evaluate 之外）", expected: "X-distill", cause: { verdict: "approved" }, run: () => DISTILL_GATE.approved },
  { name: "沉淀轮项目层免批（判定在 evaluate 之外）", expected: "X-distill", cause: { verdict: "auto-approved" }, run: () => DISTILL_GATE.auto },
];

describe("evaluate 的每个出口自报判据层", () => {
  for (const c of LAYER_CASES) {
    it(`${c.name} ⇒ layer=${c.expected}`, () => {
      const r = c.run() as { layer?: string; reason?: string };
      expect(r).toMatchObject({ layer: c.expected, ...(c.cause ?? {}) });
      if (c.reasonEquals !== undefined) expect(r.reason).toBe(c.reasonEquals);
      if (c.reasonContains !== undefined) expect(String(r.reason ?? "")).toContain(c.reasonContains);
    });
  }

  it("穷尽：GATE_LAYERS 里每层都有用例（新增层不许没有判据）", () => {
    const covered = new Set(LAYER_CASES.map((c) => c.expected));
    expect(GATE_LAYERS.filter((l) => !covered.has(l))).toEqual([]);
  });

  // 只钉层的判据分不出同层的几种因（L0-hard 一层四因、出口 17 处 vs 层 12 个），
  // 于是「因错而层对」的错案照样绿 ⇒ 每条用例都得钉住因。
  // 这条断言同时堵住「加一条只钉层的用例，把上面那条豁免掉」这个后门。
  it("穷尽：每条用例都钉住了「凭哪一条判据」（只钉层 ⇒ 同层换因照样过）", () => {
    const bare = LAYER_CASES
      .filter((c) => c.cause === undefined && c.reasonEquals === undefined && c.reasonContains === undefined)
      .map((c) => c.name);
    expect(bare).toEqual([]);
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
