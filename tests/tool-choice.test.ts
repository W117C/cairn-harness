// W3b 投影测：每条读数各测其定义，外加「比率只在合并后算」与「未证不是 0」两条口径。
import { describe, expect, it } from "vitest";
import { formatToolChoice, projectSession, projectToolChoice, WAIT_TOOL_NAME } from "../src/agent/tool-choice";
import type { AgentEvent } from "../src/events";

const call = (id: string, name: string, args: Record<string, unknown> = {}, agent?: string): AgentEvent =>
  ({ type: "tool_call", id, name, args, ...(agent === undefined ? {} : { agent_id: agent }) });
const res = (callId: string, ok = true, output = "同一份结果"): AgentEvent =>
  ({ type: "tool_result", callId, ok, output });
const vres = (ok: boolean, auto = false, agent?: string): AgentEvent =>
  ({ type: "verify_result", callId: "v1", ok, attempt: 1, maxAttempts: 3, results: [],
    ...(auto ? { auto: true } : {}), ...(agent === undefined ? {} : { agent_id: agent }) });
const spawn = (id: string): AgentEvent =>
  ({ type: "agent_spawned", agent_id: id, parent_event_id: 1, mode: "read", task: "t", max_turns: 40, permission_mode: "auto" });
const wresult = (id: string): AgentEvent =>
  ({ type: "agent_result", agent_id: id, status: "done", summary: "s", artifacts: { report: "s" },
    usage: { inputTokens: 1, outputTokens: 1 }, tool_stats: {} });
const one = (ev: readonly AgentEvent[]) => projectToolChoice([ev]);

describe("tool-choice 投影", () => {
  it("空输入：计数为 0，但比率是 null 不是 0（未证 ≠ 通过）", () => {
    const r = one([]);
    expect(r.toolCalls).toBe(0);
    expect(r.repeat.value).toBeNull();
    expect(r.byTool).toEqual({});
    expect(r.orchestration.orphans).toBe(0);
    expect(r.unmeasurable.length).toBeGreaterThan(0);
  });

  it("逐工具失败率：2 次调用 1 次失败 = 50%", () => {
    const r = one([call("a", "grep"), res("a", false), call("b", "grep"), res("b", true, "x")]);
    expect(r.byTool["grep"]).toEqual({ calls: 2, failures: 1, failRate: 0.5 });
  });

  it("重复探测只按「同 action + 逐字相同结果」判；换参数就不算", () => {
    const ev = [call("1", "read_file", { path: "a.ts" }), res("1"), call("2", "read_file", { path: "a.ts" }), res("2"),
      call("3", "read_file", { path: "b.ts" }), res("3", true, "别的")];
    const r = one(ev);
    expect(r.repeat).toEqual({ n: 1, over: 3, value: 1 / 3 });
  });

  it("收队读数：派了 worker 但没调 wait_for_agents 要被点名；调过就不点名", () => {
    const noWait = one([call("s", "spawn_agent"), spawn("w1"), wresult("w1")]);
    expect(noWait.orchestration).toMatchObject({ spawns: 1, results: 1, orphans: 0, waitCalls: 0, spawnSessions: 1, spawnSessionsWithoutWait: 1 });
    const withWait = one([call("s", "spawn_agent"), spawn("w1"), wresult("w1"), call("t", WAIT_TOOL_NAME), res("t", true, "[join] …")]);
    expect(withWait.orchestration.spawnSessionsWithoutWait).toBe(0);
    expect(withWait.orchestration.waitCalls).toBe(1);
    expect(one([call("s", "spawn_agent"), spawn("w1")]).orchestration.orphans).toBe(1); // 没等到终态就结束
  });

  it("写盘与验证都只算主会话侧：worker 的 verify 通过不替父会话销账", () => {
    const workerWrite = one([call("w", "write_file", { path: "x" }, "w1"), res("w")]);
    expect(workerWrite.verification.writeSessions).toBe(0);            // worker 写盘不进主会话分母
    expect(one([call("w", "write_file", { path: "x" }), res("w"), vres(true)]).verification.writeSessionsWithoutVerifyPass).toBe(0);
    expect(one([call("w", "write_file", { path: "x" }), res("w"), vres(false)]).verification.writeSessionsWithoutVerifyPass).toBe(1);
    // 绊线的另一头：verify_result 现在带归因（withAgentId 已覆盖），worker 的通过不得清主会话的账。
    expect(one([call("w", "write_file", { path: "x" }), res("w"), vres(true, false, "w1")]).verification.writeSessionsWithoutVerifyPass).toBe(1);
  });

  it("自动验证拍单独计数（能力 5 的补拍不等于模型自调）", () => {
    const r = one([call("v", "verify"), vres(true, true)]);
    expect(r.verification).toMatchObject({ selfCalls: 1, autoBeats: 1, passes: 1 });
  });

  it("error 事件类型名是 \"error\"：写成 run_error 这条会静默数 0", () => {
    expect(one([{ type: "error", message: "boom", step: 2 }]).runErrors).toBe(1);
  });

  it("skill 与 MCP scoped 名各自归类（MCP 命名反解复用 plugins/mcp，不抄第二份）", () => {
    const r = one([call("1", "skill", { name: "/p:s" }), res("1"), call("2", "mcp__plugin_p_srv__tool"), res("2")]);
    expect(r.plugins).toEqual({ skillCalls: 1, mcpCalls: 1 });
  });

  it("旁路 tool_result（无配对调用）不进分母——它不是模型的一次探测", () => {
    const r = one([res("ghost"), call("1", "read_file"), res("1")]);
    expect(r.repeat.over).toBe(1);
  });

  it("比率只在合并后算：2 次里 1 次重复 + 4 次里 0 次 ⇒ 合并 1/6，而不是两个比率的平均 25%", () => {
    const a = [call("1", "read_file", { path: "x" }), res("1"), call("2", "read_file", { path: "x" }), res("2")];
    const b = [call("3", "read_file", { path: "y" }), res("3"), call("4", "read_file", { path: "z" }), res("4", true, "p"),
      call("5", "read_file", { path: "w" }), res("5", true, "q"), call("6", "read_file", { path: "v" }), res("6", true, "r")];
    const merged = projectToolChoice([a, b]);
    expect(merged.repeat).toEqual({ n: 1, over: 6, value: 1 / 6 });
    expect(projectToolChoice([a]).repeat.value).toBe(0.5);   // 单会话读数仍是自己的那个数
  });

  it("投影幂等且不改入参（同一份事件重跑必须逐字同值）", () => {
    const ev = [call("1", "grep"), res("1"), spawn("w1"), wresult("w1")];
    const snap = JSON.stringify(ev);
    expect(projectSession(ev)).toEqual(projectSession(ev));
    expect(JSON.stringify(ev)).toBe(snap);
  });

  it("打印面把边界与读数放同一屏", () => {
    const text = formatToolChoice(one([call("s", "spawn_agent"), spawn("w1")]));
    expect(text).toContain("没调过收队工具");
    expect(text).toContain("选对率");        // 答不出的那条必须同屏出现
    expect(text).toContain("收队调用 0");     // 数字直接印在行里，不靠读者自己减
    expect(text).toContain("代理量");
  });
});
