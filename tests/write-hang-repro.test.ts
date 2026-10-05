// 台账 #96 的诊断判卷：交互档 run 的写向「无回执即悬挂」停在哪一格，以及修法落地后那一格还回不回得来。
// 读数各有界（本文件没有一条会等满 AskGate 的缺省看门狗）：
//   ① 纯函数 `evaluate`：自主档出不出卡，唯一变量是沙箱读数（`false` 才出）。
//   ② 真实入口 `handleAgentRun`：卡到达的那一刻 `tool_call` 已在流上而 `tool_result` 不在，
//      应答之后同毫秒级出回执 ⇒ 写向回执**挂在一张没人接的审批卡上**，不是挂在执行器里。
//   ③ 装配口：`runAgent` 收 `askGate` 注入，`handleAgentRun` 的第二参**没有这个键**——
//      旧探针「注入一个立刻批准的门也没打印 ASK」由此解释（那条读数不能用来排除审批通道）。
//   ⑤⑥ 修法两格：`noAnswerer`（管道形状）与「门装配了但没注册应答人」都当场按 `unattended` 拒收束，
//      ⑥b 是正半边——有应答人时照旧送卡并等到决议，这一闸不许把所有审批都变成拒。
// 为什么本文件不复刻生产应答人装配：`src/cli.ts` 自己 `initSandbox()` 并注册 `onAsk` 去答卡，
// 照抄它就把要量的东西造出来了（探针臂 D 已单独量过那一格）。
// 60s 那条完整收束读数在 `outputs/write-hang-repro-2026-10-05/`（探针臂 A-full60），不在这里跑。
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleAgentDecide, handleAgentRun, handleRunCancel, runAgent,
  initSessionsDir, initSettingsStore, setAppHooks,
} from "../src/main/agent-runner";
import { AskGate } from "../src/main/ask-gate";
import { evaluate, newAutonomySession } from "../src/permissions";
import type { AgentEvent, ToolResultEvent } from "../src/events";
import type { AskPayload } from "../src/main/ipc-protocol";

const WRITE_ARGS = { path: "hang-probe.ts", content: "export const x = 1;\n" };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 有界等待一个谓词；超时即抛（抛之前那条 run 由 `converge` 收束，不留 60s 看门狗给进程）。 */
async function until(pred: () => boolean, budgetMs: number, what: string): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(20);
  }
  throw new Error("等不到：" + what);
}

/** 把在途的 run 收干净：取消信号沿门透传（`gatedTool` 传了 `ctx.signal`），当场按拒绝收束。 */
async function converge(runP: Promise<unknown>): Promise<void> {
  handleRunCancel();
  await Promise.race([runP, sleep(3_000)]);
}

function toolResultsOf(events: AgentEvent[], layer: string): ToolResultEvent[] {
  return events.filter((e): e is ToolResultEvent =>
    e.type === "tool_result" && (e as ToolResultEvent).gate?.layer === layer);
}

describe("#96 写向悬挂：卡在哪一格", () => {
  let dir: string;
  let workspace: string;
  let sessions: string;
  let scriptPath: string;
  let logPath: string;
  let cards: AskPayload[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dsh-96-hang-"));
    workspace = join(dir, "ws");
    sessions = join(dir, "sessions");
    scriptPath = join(dir, "script.jsonl");
    await mkdir(workspace, { recursive: true });
    await mkdir(sessions, { recursive: true });
    initSessionsDir(sessions);
    initSettingsStore(join(dir, "settings.json"));
    logPath = join(sessions, "s-96-direct.jsonl");
    await writeFile(scriptPath, JSON.stringify({ type: "tool_call", id: "w1", name: "write_file", args: WRITE_ARGS }) +
      "\n" + JSON.stringify({ type: "assistant_message", content: "写完了。" }) + "\n", "utf8");
    vi.stubEnv("M3A_MAIN_SCRIPT", scriptPath);
    cards = [];
    setAppHooks({ onAsk: (p) => { cards.push(p); } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setAppHooks({ onAsk: undefined });
  });

  it("① 自主档写向出卡与否，只看沙箱读数：false 出卡走 L4-risk，null/true 直接放行", () => {
    const session = (sandboxAvailable: boolean | null) => newAutonomySession("auto", { sandboxAvailable });
    const degraded = evaluate("write_file", WRITE_ARGS, session(false));
    const unknown = evaluate("write_file", WRITE_ARGS, session(null));
    const healthy = evaluate("write_file", WRITE_ARGS, session(true));
    expect(degraded.verdict).toBe("ask");
    expect(degraded.layer).toBe("L4-risk");
    expect(unknown.verdict).toBe("approve");
    expect(healthy.verdict).toBe("approve");
  });

  it("② 交互档 run：卡到达时无 tool_result，答完即出（回执挂在卡上，不挂在执行器）", { timeout: 20_000 }, async () => {
    const sessionId = "s-96-answer";
    const events: AgentEvent[] = [];
    const runP = handleAgentRun(
      { message: "写个文件", mode: "auto", sessionId },
      {
        workspace, sessionId, logPath: join(sessions, sessionId + ".jsonl"),
        planRequired: false, onEvent: (e) => { events.push(e); },
      },
    );
    try {
      await until(() => cards.length > 0, 5_000, "审批卡送达");
      expect(cards[0]?.tool).toBe("write_file");
      expect(cards[0]?.risk).toBe("high");
      expect(events.some((e) => e.type === "tool_call")).toBe(true);
      expect(events.some((e) => e.type === "tool_result")).toBe(false);
      expect(handleAgentDecide(String(cards[0]?.askId), true)).toBe(true);
      expect((await runP).ok).toBe(true);
    } catch (err) {
      await converge(runP);
      throw err;
    } finally {
      for (const c of cards) handleAgentDecide(c.askId, false);
    }
    const parked = toolResultsOf(events, "L4-risk");
    expect(parked).toHaveLength(1);
    expect(parked[0]?.ok).toBe(true);
    expect(parked[0]?.gate?.verdict).toBe("approved");
  });

  it("③ 装配口：runAgent 收 askGate 注入，handleAgentRun 的第二参不收（门被钉死成交互面那只）", { timeout: 20_000 }, async () => {
    // 3a —— 内层入口可注入：门一到就答，写向真的落盘。
    const asked: string[] = [];
    const stub = new AskGate({
      timeoutMs: 1_000,
      notify: (req) => { asked.push(String(req.tool)); stub.decide(req.askId, true, "user", "once"); },
    });
    const events = await runAgent({
      workspace, message: "写个文件", mode: "auto", logPath,
      askGate: stub, sandbox: { available: false, reason: "注入：沙箱降级" },
    });
    expect(asked).toEqual(["write_file"]);
    expect(toolResultsOf(events, "L4-risk")[0]?.ok).toBe(true);

    // 3b —— 生产入口不收这个键：注入的门一次都没被问，卡照旧出自 appAskGate。
    let injectedCalls = 0;
    const injected = {
      request: async () => { injectedCalls += 1; return { outcome: "approved" as const, scope: "once" as const }; },
    };
    const sessionId = "s-96-inject";
    const over = {
      workspace, sessionId, logPath: join(sessions, sessionId + ".jsonl"),
      planRequired: false, askGate: injected,
    } as unknown as Parameters<typeof handleAgentRun>[1];
    const runP = handleAgentRun({ message: "写个文件", mode: "auto", sessionId }, over);
    try {
      await until(() => cards.length > 0, 5_000, "交互面审批卡送达");
      expect(injectedCalls).toBe(0);
      expect(cards[0]?.tool).toBe("write_file");
      expect(handleAgentDecide(String(cards[0]?.askId), false)).toBe(true);
      await runP;
    } catch (err) {
      await converge(runP);
      throw err;
    } finally {
      for (const c of cards) handleAgentDecide(c.askId, false);
    }
  });

  it("④ 无人值守基线：同一次写向当场按拒绝收束，不进等待（这就是重写后能过的原因）", { timeout: 20_000 }, async () => {    const sessionId = "s-96-unattended";
    const events: AgentEvent[] = [];
    const t0 = Date.now();
    const res = await handleAgentRun(
      { message: "写个文件", mode: "auto", sessionId },
      {
        workspace, sessionId, logPath: join(sessions, sessionId + ".jsonl"),
        planRequired: false, unattended: true, onEvent: (e) => { events.push(e); },
      },
    );
    expect(res.ok).toBe(true);
    const denied = toolResultsOf(events, "L4-risk");
    expect(denied).toHaveLength(1);
    expect(denied[0]?.ok).toBe(false);
    expect(denied[0]?.gate?.verdict).toBe("unattended");
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(cards).toHaveLength(0);
  });

  // ---- 修法（#96 收口）：装配点一格、门自身两格（负／正），每根锚点各有一个看得见它的观察者 ----

  it("⑤ 管道形状（只给 noAnswerer，不给 unattended）⇒ 不出卡、当场按无人值守拒收束，不等 60s", { timeout: 20_000 }, async () => {
    const sessionId = "s-96-noanswerer";
    const events: AgentEvent[] = [];
    const t0 = Date.now();
    const res = await handleAgentRun(
      { message: "写个文件", mode: "auto", sessionId },
      {
        workspace, sessionId, logPath: join(sessions, sessionId + ".jsonl"),
        planRequired: false, noAnswerer: true, onEvent: (e) => { events.push(e); },
      },
    );
    expect(res.ok).toBe(true);
    expect(cards, "noAnswerer 这一路还在往交互面上送卡 ⇒ 送出去也没人答，就是那 60s").toHaveLength(0);
    const denied = toolResultsOf(events, "L4-risk");
    expect(denied).toHaveLength(1);
    expect(denied[0]?.ok).toBe(false);
    expect(denied[0]?.gate?.verdict, "理由必须是「无人应答」，不是「等满了没等到」").toBe("unattended");
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("⑥ 生产装配的交互门没注册应答人 ⇒ run 当场收束（这条钉的是装配点那一句，不是门自己）", { timeout: 20_000 }, async () => {
    setAppHooks({ onAsk: undefined }); // beforeEach 注册过；这一格显式撤掉＝`handleAgentRun` 的调用方什么也没搭
    const sessionId = "s-96-unarmed";
    const events: AgentEvent[] = [];
    const t0 = Date.now();
    const res = await handleAgentRun(
      { message: "写个文件", mode: "auto", sessionId },
      { workspace, sessionId, logPath: join(sessions, sessionId + ".jsonl"), planRequired: false, onEvent: (e) => { events.push(e); } },
    );
    expect(res.ok).toBe(true);
    expect(cards, "没注册应答人还去送卡 ⇒ 卡被静默丢弃，写向就挂在看门狗上").toHaveLength(0);
    const denied = toolResultsOf(events, "L4-risk");
    expect(denied).toHaveLength(1);
    expect(denied[0]?.ok).toBe(false);
    expect(denied[0]?.gate?.verdict).toBe("unattended");
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it("⑥b 门自身那一格（负）：hasAnswerer 判假 ⇒ 不 notify、当场拒、pending 归零", async () => {
    const delivered: string[] = [];
    const outcomes: string[] = [];
    const gate = new AskGate({
      timeoutMs: 1_000,
      notify: (req) => { delivered.push(String(req.tool)); },
      notifyOutcome: (askId, outcome, reason) => { outcomes.push(outcome + "/" + reason); },
      hasAnswerer: () => false,
    });
    const t0 = Date.now();
    const r = await gate.request("write_file", WRITE_ARGS, { risk: "high" });
    expect(r.outcome).toBe("rejected");
    expect(r.reason, "不新增词汇：没送到也按既有的 unattended 记").toBe("unattended");
    expect(delivered, "没人可送还去 notify ⇒ 那张卡被静默丢弃，正是悬挂的成因").toHaveLength(0);
    expect(outcomes).toEqual(["rejected/unattended"]);
    expect(gate.pendingCount).toBe(0);
    expect(Date.now() - t0).toBeLessThan(900);
  });

  it("⑥c 门自身那一格（正）：`hasAnswerer` 判真时照旧送卡并等到决议（这一闸不许把所有审批都变成拒）", async () => {
    const delivered: string[] = [];
    const gate = new AskGate({
      timeoutMs: 1_000,
      notify: (req) => { delivered.push(String(req.tool)); gate.decide(req.askId, true); },
      hasAnswerer: () => true,
    });
    const r = await gate.request("write_file", WRITE_ARGS, { risk: "high" });
    expect(delivered).toEqual(["write_file"]);
    expect(r.outcome).toBe("approved");
    expect(gate.pendingCount).toBe(0);
  });
});
