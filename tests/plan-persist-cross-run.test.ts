// #84（plan 半）：方案门的「存在未批准方案」必须有盘上的事实源。
//
// 缺陷形状：`markPlanProposed()` 改的是 run 级 ALS 里的布尔，而 `enterPlanRunScope()` 在**每一条
// 用户消息**的 run 入口都从 `{required, proposed:false, approved:false}` 重新武装 ⇒ propose_plan
// 给模型的那句回执「方案被拒绝：写禁保持（存在未批准 plan）」只在本轮成立：下一条消息写面就敞开了。
// 上一版只有 `planRequired`（用户武装的 plan 模式）跨 run 生效，因为每次入口都从请求/设置重取；
// 自愿提交那一半没有对应的重取点 —— 所以这不是「重启才丢」，是「换个 turn 就丢」。
//
// 两层判卷（各盯一件事，缺一层就有一个洞）：
//   ① 纯投影逐格穷举：正／反／交错（先拒后批）／没人答 —— 真仓数据分辨不了语义差；
//   ② 生产入口连跑两轮：第一轮真提方案、决议真经 `handlePlanDecide` 落盘，第二轮真试着写盘。
//      只有 ② 能证明「播种接到了 runAgent 上」，只有 ① 能证明「交错顺序不写反」。
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replay, type AgentEvent } from "../src/events";
import { handleAgentRun, handlePlanDecide, initSessionsDir } from "../src/main/agent-runner";
import { pathOf } from "../src/main/sessions";
import {
  enterPlanRunScope,
  getPlanState,
  planGateBlocks,
  planPendingFromEvents,
  resetPlanState,
  seedPendingPlanFromEvents,
} from "../src/permissions";

const PROPOSE = (id: string): AgentEvent => ({
  type: "plan_proposed",
  callId: id,
  plan: { goal: "改 a.ts", files: [{ path: "a.ts", action: "edit", summary: "改一行" }] },
});
const DECIDE = (id: string, approved: boolean): AgentEvent => ({ type: "plan_approved", callId: id, approved });

describe("① planPendingFromEvents：盘上那条事实怎么投影成门布尔", () => {
  it("提交了、没有任何决议 ⇒ 有待决方案（这就是「没人答」那一格）", () => {
    expect(planPendingFromEvents([PROPOSE("c1")])).toBe(true);
  });

  it("批准后不再算待决；**拒绝仍算待决**（回执那句「写禁保持」不许换个 run 就翻脸）", () => {
    expect(planPendingFromEvents([PROPOSE("c1"), DECIDE("c1", true)])).toBe(false);
    expect(planPendingFromEvents([PROPOSE("c1"), DECIDE("c1", false)])).toBe(true);
  });

  it("交错：c1 拒、c2 批 ⇒ 不留待决；c1 批、c2 只提交 ⇒ 留 c2", () => {
    expect(planPendingFromEvents([PROPOSE("c1"), DECIDE("c1", false), PROPOSE("c2"), DECIDE("c2", true)])).toBe(false);
    expect(planPendingFromEvents([PROPOSE("c1"), DECIDE("c1", true), PROPOSE("c2")])).toBe(true);
  });

  it("没有 plan 事件 ⇒ false（零行为：负控，防这把尺恒真）", () => {
    expect(planPendingFromEvents([])).toBe(false);
    expect(planPendingFromEvents([{ type: "user_message", content: "随便一句" }])).toBe(false);
  });

  it("播种只喂事实：没待决就一个字节不改，有待决才把门武装上", () => {
    resetPlanState();
    try {
      enterPlanRunScope(false);
      // 判据用生产那一份（planGateBlocks 吃 getPlanState），测试里不重写比较式
      expect(seedPendingPlanFromEvents([{ type: "user_message", content: "没有方案" }])).toBe(false);
      expect(getPlanState()).toEqual({ required: false, proposed: false, approved: false });
      expect(planGateBlocks(getPlanState())).toBe(false);
      expect(seedPendingPlanFromEvents([PROPOSE("c1")])).toBe(true);
      expect(planGateBlocks(getPlanState())).toBe(true);
      // 武装态（用户开了 plan 模式）里播种不许把 required 洗掉
      enterPlanRunScope(true);
      seedPendingPlanFromEvents([PROPOSE("c2")]);
      expect(getPlanState().required).toBe(true);
    } finally {
      resetPlanState();
    }
  });
});

describe("② 生产入口连跑两轮：未批准的方案跨得过硬切换", () => {
  let root = "";
  let workspace = "";
  let sessions = "";
  let scriptPath = "";
  let logPath = "";

  async function script(raw: string): Promise<void> {
    await writeFile(scriptPath, raw, "utf8");
  }

  const proposeScript =
    '{"type":"tool_call","id":"p1","name":"propose_plan","args":{"goal":"建 todo 面","files":[{"path":"todo.ts","action":"create","summary":"新建一个文件"}]}}\n' +
    '{"type":"assistant_message","content":"方案提交了，等人批。"}\n';
  const writeScript =
    '{"type":"tool_call","id":"w1","name":"write_file","args":{"path":"x-second-turn.ts","content":"export const x = 1;\\n"}}\n' +
    '{"type":"assistant_message","content":"写完了。"}\n';

  const resultFor = async (callId: string): Promise<{ ok: boolean; output: string }> => {
    const hit = (await replay(logPath)).find((e) => e.type === "tool_result" && e.callId === callId);
    return hit?.type === "tool_result" ? { ok: hit.ok, output: hit.output } : { ok: false, output: "<没有 tool_result>" };
  };

  /** 第一轮：真提方案，决议由**真入口**给出（handlePlanDecide 是 plan_approved 全仓唯一写点）。 */
  async function runFirstTurn(sessionId: string, approve: boolean): Promise<void> {
    await script(proposeScript);
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    logPath = pathOf(sessions, sessionId);
    const decided = (e: AgentEvent): void => {
      if (e.type === "plan_proposed") void handlePlanDecide(approve, e.callId);
    };
    const res = await handleAgentRun(
      { message: "先提个方案", mode: "auto", sessionId },
      // planRequired 显式给 false：这三支配的是「自愿提交那一半」，不许被设置盘里那个
      // 缺省布尔（/tmp 上跨会话共享）顶掉——顶掉了就变成测武装态，而那是 J4 的格子。
      { workspace, sessionId, logPath, unattended: false, planRequired: false, onEvent: decided },
    );
    expect(res.ok).toBe(true);
  }

  /** 第二轮：**新的一次 handleAgentRun**（换 turn＝重新过 run 入口），只试着写盘。
   *  这一轮走 `unattended:true` 是有意的：它让写向**必然被拒**，于是唯一能读的信号是**谁在答话**
   *  （方案门 L0 排在 ask 之前，未武装时不许说话）——与 `tests/goal-continue.test.ts` 的 J3 同型。
   *  不用「写成功」当判据还有一个原因：本轮实测发现 `unattended:false` 的交互 run 在 write_file
   *  那一步根本不回回执（探针 `outputs/plan-persist-2026-10-05/probe-stall.mts`，HEAD 干净树同形复现，
   *  已另立 `#96`）；拿一个悬挂的形状当证人，判卷只会红在别处。 */
  async function runSecondTurn(sessionId: string): Promise<{ ok: boolean; output: string }> {
    await script(writeScript);
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    logPath = pathOf(sessions, sessionId);
    const res = await handleAgentRun(
      { message: "现在写那个文件", mode: "auto", sessionId },
      { workspace, sessionId, logPath, unattended: true, planRequired: false },
    );
    expect(res.ok).toBe(true); // 被门拒 ≠ run 失败：拒绝是正常收场
    return await resultFor("w1");
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "plan-persist-"));
    workspace = join(root, "ws");
    sessions = join(root, "sessions");
    scriptPath = join(root, "script.jsonl");
    await mkdir(sessions, { recursive: true });
    await mkdir(workspace, { recursive: true });
    initSessionsDir(sessions);
  });

  afterEach(async () => {
    delete process.env.M3A_MAIN_SCRIPT;
    await rm(root, { recursive: true, force: true });
  });

  it("第一轮方案被拒 ⇒ 第二轮（新 run）写盘仍被方案门挡住，盘上不留痕", async () => {
    await runFirstTurn("s-rejected", false);
    const decided = (await replay(logPath)).filter((e) => e.type === "plan_approved");
    expect(decided, "第一轮没落 plan_approved ⇒ 决议没走真入口").toHaveLength(1);

    const second = await runSecondTurn("s-rejected");
    expect(second.ok).toBe(false);
    expect(second.output).toContain("方案门");
    await expect(access(join(workspace, "x-second-turn.ts"))).rejects.toThrow();
  });

  it("第一轮方案获批 ⇒ 第二轮答话的是无人值守闸，方案门闭嘴（播种不许把批准过的会话锁死）", async () => {
    await runFirstTurn("s-approved", true);
    const second = await runSecondTurn("s-approved");
    expect(second.output, "已批准的会话被重新锁死＝死锁；这一格钉的是「谁在答话」").not.toContain("方案门");
    expect(second.output).toContain("无人值守");
  });

  it("会话里从来没有过方案 ⇒ 第二轮同样是无人值守闸答话，方案门不许出声（零回归证人）", async () => {
    const second = await runSecondTurn("s-plain");
    expect(second.output).not.toContain("方案门");
    expect(second.output).toContain("无人值守");
  });

  it("接线：runAgent 入口真的去读了盘上那份事实（不是只写了个纯函数）", () => {
    const src = readFileSync(join(process.cwd(), "src", "main", "agent-runner.ts"), "utf8");
    expect(/seedPendingPlanFromEvents\(await replay\(opts\.logPath\)/u.test(src), "run 入口没把播种接到 replay 上").toBe(true);
  });
});
