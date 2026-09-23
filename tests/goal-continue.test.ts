// goal 模式的端到端判卷（spec §5 J5）。走的是**生产入口**：handleGoalSet 真写 goal_set 进会话 JSONL，
// handleAgentRun 真跑一轮再自己决定要不要续——不是"手工造一份本该由别人产出的输入"（那是本仓点名的假绿形状）。
// 剧本走 M3A_MAIN_SCRIPT 这条显式通道（冻结的 fixtures/mock 是判卷文件，不往里加东西）。
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replay, type AgentEvent } from "../src/events";
import { handleAgentRun, handleGoalSet, initSessionsDir, initSettingsStore, setSettings } from "../src/main/agent-runner";
import { pathOf } from "../src/main/sessions";
import { projectGoal } from "../src/agent/goal";

let root = "";
let workspace = "";
let sessions = "";
let scriptPath = "";
let logPath = "";

const TEXT_ONLY = '{"type":"assistant_message","content":"我说完了，但没有产出。"}\n';

async function script(raw: string): Promise<void> {
  await writeFile(scriptPath, raw, "utf8");
}

async function events(): Promise<AgentEvent[]> {
  return replay(logPath);
}

const userTurns = (evts: AgentEvent[]): AgentEvent[] => evts.filter((e) => e.type === "user_message");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "goal-run-"));
  workspace = join(root, "ws");
  sessions = join(root, "sessions");
  scriptPath = join(root, "script.jsonl");
  // 会话日志一律取 handleGoalSet 会写的那个路径（同一个文件才是同一份事实源；
  // 上一版这里另指一个 tmp 文件，goal_set 落 A、run 读 B，三条断言一起假红）
  await mkdir(sessions, { recursive: true });
  logPath = pathOf(sessions, "s-plain");
  await mkdir(workspace, { recursive: true });
  initSessionsDir(sessions);
  await script(TEXT_ONLY);
});

afterEach(async () => {
  delete process.env.M3A_MAIN_SCRIPT;
  await rm(root, { recursive: true, force: true });
});

describe("goal 模式端到端（真入口，缺省零行为）", () => {
  it("没设目标 ⇒ 一轮收束就结束，不多跑一轮、不写 goal_set/goal_stopped（逐字零行为）", async () => {
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    const res = await handleAgentRun(
      { message: "做点事", mode: "auto", sessionId: "s-plain" },
      { workspace, sessionId: "s-plain", logPath, unattended: true },
    );
    expect(res.ok).toBe(true);
    const evts = await events();
    expect(userTurns(evts).length).toBe(1);
    expect(evts.some((e) => e.type === "goal_set" || e.type === "goal_stopped")).toBe(false);
    expect(projectGoal(evts)).toBeNull();
  });

  it("设了目标但这一轮没写盘也没验证 ⇒ 立刻停，并落一条写明理由的 goal_stopped（读答型目标不烧钱）", async () => {
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    const set = await handleGoalSet({ sessionId: "s-plain", objective: "回答这个问题", maxTurns: 6 });
    expect(set.ok).toBe(true);
    // 交互 run：这条测的是**判据**「没写盘也没绿证据 ⇒ 别续」。无人值守那条路在判据之前
    // 就被 #53 的裁决拦下（见下面单独一条），拿 unattended 跑这条只会验到那道闸。
    const res = await handleAgentRun(
      { message: "回答一下", mode: "auto", sessionId: "s-plain" },
      { workspace, sessionId: "s-plain", logPath, unattended: false },
    );
    expect(res.ok).toBe(true);
    const evts = await events();
    expect(userTurns(evts).length).toBe(1); // 没有被自动续跑
    const stops = evts.filter((e) => e.type === "goal_stopped");
    expect(stops.length).toBe(1);
    expect(stops[0]?.type === "goal_stopped" && stops[0].reason).toContain("没有写过任何文件");
    const view = projectGoal(evts);
    expect(view?.spec.objective).toBe("回答这个问题");
    expect(view?.evidence).toBe("absent");
    expect(view?.stopped).not.toBeNull();
  });

  it("goal_set 由 handleGoalSet 真写：非法目标被拒且不落流；越界轮次被钳并回条点名", async () => {
    const bad = await handleGoalSet({ sessionId: "s-plain", objective: "   " });
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("objective");
    // 被拒的设定连文件都不该建起来（不是"建了个空文件"，也不是落了半个 goal_set）
    await expect(access(logPath)).rejects.toThrow();
    const wide = await handleGoalSet({ sessionId: "s-plain", objective: "改点东西", maxTurns: 999 });
    expect(wide.ok).toBe(true);
    expect(wide.clamped?.join()).toContain("25");
    const evts = await events();
    expect(evts.filter((e) => e.type === "goal_set").length).toBe(1);
    expect(evts[0]?.type === "goal_set" && evts[0].max_turns).toBe(25);
  });

  it("无人值守 run 到点就停且不续跑（#53）：理由点名这条路，且**排在判据之前**", async () => {
    // 为什么这是一条真规则而不是保守：unattended 的审批一律 fail-closed 拒 ⇒ 这一轮写不了盘、
    // verify 必红，而判据对"证据 failed"是 continue ⇒ 定时任务会一路烧到轮次上限且不可能成功。
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    await handleGoalSet({ sessionId: "s-plain", objective: " nightly 修绿", maxTurns: 8 });
    const res = await handleAgentRun(
      { message: "开始", mode: "auto", sessionId: "s-plain" },
      { workspace, sessionId: "s-plain", logPath, unattended: true },
    );
    expect(res.ok).toBe(true);
    const evts = await events();
    const stops = evts.filter((e) => e.type === "goal_stopped");
    expect(stops.length).toBe(1);
    const reason = stops[0]?.type === "goal_stopped" ? stops[0].reason : "";
    expect(reason).toContain("无人值守");
    // 顺序即优先级：这条理由**不许**被"没写过任何文件"那条判据理由顶掉——顶掉了就说明
    // 无人值守的 run 仍在按判据决定要不要再烧一轮（正是要拦的事）。
    expect(reason).not.toContain("没有写过任何文件");
    expect(userTurns(evts).filter((t) => t.type === "user_message" && t.origin?.kind === "goal").length).toBe(0);
    // 停下来的理由照样进投影：芯片/转录读得到（不是只 return 掉）
    const view = projectGoal(evts);
    expect(view?.stopped).toContain("无人值守");
    expect(view?.turn).toBe(1);
  });

  it("停过的目标不会因用户再发一条而自动复活：停止是终态，要再跑得改设目标", async () => {
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    await handleGoalSet({ sessionId: "s-plain", objective: "回答问题", maxTurns: 6 });
    const first = await handleAgentRun(
      { message: "第一问", mode: "auto", sessionId: "s-plain" },
      { workspace, sessionId: "s-plain", logPath, unattended: false },
    );
    expect(first.ok).toBe(true);
    expect((await events()).filter((e) => e.type === "goal_stopped").length).toBe(1);
    // 用户接着又发一条（同一个会话、同一个 goal_set 还在流里）：这条**不该**把自动续跑唤回来
    const second = await handleAgentRun(
      { message: "第二问", mode: "auto", sessionId: "s-plain" },
      { workspace, sessionId: "s-plain", logPath, unattended: false },
    );
    expect(second.ok).toBe(true);
    const evts = await events();
    const turns = userTurns(evts);
    // 两条人手消息 + 零条 goal 代发轮；goal_stopped 仍然只有一条（停止不是"暂停一下"）
    expect(turns.filter((t) => t.type === "user_message" && t.origin?.kind === "goal").length).toBe(0);
    expect(turns.length).toBe(2);
    expect(evts.filter((e) => e.type === "goal_stopped").length).toBe(1);
  });

  it("轮次上限到点必停：只跑到 maxTurns 轮，且最后一轮仍是 goal 代发的（origin 记着是谁发的）", async () => {
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    await handleGoalSet({ sessionId: "s-plain", objective: "把测试修绿", maxTurns: 1 });
    const res = await handleAgentRun(
      { message: "开始", mode: "auto", sessionId: "s-plain" },
      { workspace, sessionId: "s-plain", logPath, unattended: false },
    );
    expect(res.ok).toBe(true);
    const evts = await events();
    const turns = userTurns(evts);
    // maxTurns=1：第 1 轮跑完就停，一条续跑轮都不许起（轮次闸在"无产出闸"之前判，理由点名轮次）
    expect(turns.length).toBe(1);
    const stop = evts.find((e) => e.type === "goal_stopped");
    expect(stop?.type === "goal_stopped" && stop.reason).toContain("轮次上限");
  });

  it("清除目标 = 落一条 goal_stopped（不开新事件、不开新通道）：幂等，且此后不再自动续跑", async () => {
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    // 没设过目标的会话（日志还不存在）：报"没有目标"，不是把 ENOENT 端给用户
    const nothing = await handleGoalSet({ sessionId: "s-plain", clear: true });
    expect(nothing.ok).toBe(false);
    expect(nothing.error).toContain("没有设过目标");
    expect(nothing.error ?? "").not.toContain("ENOENT");
    await expect(access(logPath)).rejects.toThrow(); // 拒绝即不建文件：清除不许凭空造一份转录

    await handleGoalSet({ sessionId: "s-plain", objective: "把测试修绿", maxTurns: 6 });
    const cleared = await handleGoalSet({ sessionId: "s-plain", clear: true });
    expect(cleared.ok).toBe(true);
    const stops = (await events()).filter((e) => e.type === "goal_stopped");
    expect(stops.length).toBe(1);
    expect(stops[0]?.type === "goal_stopped" && stops[0].reason).toContain("用户清除目标");
    expect(projectGoal(await events())?.stopped).not.toBeNull();

    // 再点一次清除：幂等返回成功，但不许补记第二条停止（审计面上"停了几次"必须是真的）
    expect((await handleGoalSet({ sessionId: "s-plain", clear: true })).ok).toBe(true);
    expect((await events()).filter((e) => e.type === "goal_stopped").length).toBe(1);

    // 清除后用户发一条：这一轮跑完就结束——复用「停止是终态」那条已有语义，而不是新写一份
    const res = await handleAgentRun(
      { message: "接着做", mode: "auto", sessionId: "s-plain" },
      { workspace, sessionId: "s-plain", logPath, unattended: true },
    );
    expect(res.ok).toBe(true);
    const evts = await events();
    expect(userTurns(evts).length).toBe(1);
    expect(evts.filter((e) => e.type === "goal_stopped").length).toBe(1);
  });

  it("unattended + 武装方案门 ⇒ 拒因来自方案门而不是无人值守闸，盘上不留痕（J3：不是被忽略）", async () => {
    // 定时任务那条路就是 `{ unattended: true }`：写向工具本来就会被"无人值守 fail-closed"自动拒。
    // 所以 J3 判的不是"有没有被拒"（两支都拒 ⇒ 恒真），而是**哪道闸在答话**：
    // 武装后必须是方案门先拒（它在 ask 之前判），而不是把决定丢给无人值守自动拒。
    // 两支只差 planRequired 一个维度、拒因却换人 ⇒ 这道闸真在管这条路径。
    await script(
      '{"type":"tool_call","id":"w1","name":"write_file","args":{"path":"j3-probe.ts","content":"export const x = 1;\\n"}}\n' +
        '{"type":"assistant_message","content":"写完了。"}\n',
    );
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    const resultFor = async (callId: string): Promise<{ ok: boolean; output: string }> => {
      const hit = (await events()).find((e) => e.type === "tool_result" && e.callId === callId);
      return hit?.type === "tool_result" ? { ok: hit.ok, output: hit.output } : { ok: false, output: "<没有 tool_result>" };
    };

    logPath = pathOf(sessions, "s-unarmed");
    const open = await handleAgentRun(
      { message: "写个文件", mode: "auto", sessionId: "s-unarmed" },
      { workspace, sessionId: "s-unarmed", logPath, unattended: true },
    );
    expect(open.ok).toBe(true);
    const un = await resultFor("w1");
    expect(un.ok).toBe(false);
    expect(un.output).toContain("无人值守");
    expect(un.output).not.toContain("方案门"); // 未武装时这道闸不许说话

    logPath = pathOf(sessions, "s-armed");
    const gated = await handleAgentRun(
      { message: "写个文件", mode: "auto", sessionId: "s-armed" },
      { workspace, sessionId: "s-armed", logPath, unattended: true, planRequired: true },
    );
    expect(gated.ok).toBe(true); // 闸住 ≠ run 失败：拒绝是正常收场，不是崩
    const ar = await resultFor("w1");
    expect(ar.ok).toBe(false);
    expect(ar.output).toContain("方案门");
    await expect(access(join(workspace, "j3-probe.ts"))).rejects.toThrow();
  });

  it("旧日志没有 goal 事件时，重放照旧成功（增量类型不把旧转录判坏）", async () => {
    await writeFile(logPath, JSON.stringify({ type: "user_message", content: "老记录" }) + "\n", "utf8");
    const evts = await events();
    expect(evts.length).toBe(1);
    expect(projectGoal(evts)).toBeNull();
  });
});

describe("projectGoal：会话目标态只从事件流重算", () => {
  const G = (objective: string, maxTurns = 6, maxUsd = 0): AgentEvent =>
    ({ type: "goal_set", objective, max_turns: maxTurns, max_usd: maxUsd });
  const goalTurn = (turn: number): AgentEvent => ({
    type: "user_message",
    content: "续跑",
    origin: { kind: "goal", turn, max_turns: 6 },
  });

  it("轮次 = 1 + goal 代发轮数；人手发的消息不计（那是人在接管）", () => {
    const v = projectGoal([
      G("目标"),
      { type: "user_message", content: "第一条人发的" },
      goalTurn(2),
      { type: "user_message", content: "人又插了一句" },
      goalTurn(3),
    ]);
    expect(v?.turn).toBe(3);
    expect(v?.spec.objective).toBe("目标");
  });

  it("改设目标即重算窗口：绿证据只看最后一条 goal_set 之后（上一段的绿不能替新目标宣布达成）", () => {
    const verifyOk: AgentEvent = {
      type: "verify_result",
      ok: true,
      results: [{ command: "t", ok: true, output: "" }],
      callId: "v1",
      attempt: 1,
      maxAttempts: 3,
    };
    const before = projectGoal([G("旧目标"), verifyOk]);
    expect(before?.evidence).toBe("verified");
    const after = projectGoal([G("旧目标"), verifyOk, G("新目标")]);
    expect(after?.evidence).toBe("absent");
    expect(after?.turn).toBe(1);
  });

  it("美元闸的计量窗口 = 本目标之后：设目标之前花掉的钱不许替新目标触发这道闸", () => {
    // 审查 C2：证据/写盘看窗口，钱却曾看整段会话 ⇒ 同一份投影三把尺。后果不是"多花一点"，
    // 而是"设 $0.5 上限、第一轮就以『已花 $0.6』停下"——用户设的闸成了随机数。
    const use = (inputTokens: number): AgentEvent => ({ type: "usage", inputTokens, outputTokens: 0 });
    const stale = projectGoal([use(500_000), G("上一段活"), use(500_000), G("新目标")]);
    expect(stale?.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    const fresh = projectGoal([use(500_000), G("新目标"), use(1000), use(500)]);
    expect(fresh?.usage).toEqual({ inputTokens: 1500, outputTokens: 0 });
  });

  it("goal_stopped 之后 stopped 有值；再来一条 goal_set 会把它清掉（改设 = 重新起跑）", () => {
    const stopped: AgentEvent = { type: "goal_stopped", reason: "轮次上限 6 已用尽", turn: 6, evidence: "failed" };
    expect(projectGoal([G("目标"), stopped])?.stopped).toContain("轮次上限");
    expect(projectGoal([G("目标"), stopped, G("再试一次")])?.stopped).toBeNull();
  });
});

// ---- #54：美元闸的**生产输入**那一跳 ----
// 上面所有判据测的都是「拿到 spentUsd 之后怎么判」；这一段测「spentUsd 从哪来」。
// settings 存 provider 模型名（glm-5.2），价表的键是档位 id（glm-standard），中间靠一次反查。
// 那一跳坏了没有任何单测会红（它们直接注入 spentUsd）——实测就是恒「价格不可知」、闸一次也没触发过，
// tsc / vitest / 变异表全绿。所以这条必须走真入口。放在文件最后：它会把 settings 单例改指本用例的临时文件。
describe("goal 美元闸端到端：模型名也算得出钱，并且真的拦下续跑", () => {
  it("设 $0.05 上限 × 一轮 200k/20k 用量 ⇒ goal_stopped 点名美元上限（不被轮次/无产出理由顶包）", async () => {
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    initSettingsStore(join(root, "settings.json")); // 缺省落在 /tmp/m1e-default-settings.json，跨用例共享 ⇒ 自己指一份
    await setSettings({ model: "glm-5.2" });
    await script(JSON.stringify({ type: "usage", inputTokens: 200_000, outputTokens: 20_000 }) + "\n" + TEXT_ONLY);
    const set = await handleGoalSet({ sessionId: "s-plain", objective: "把测试修绿", maxTurns: 8, maxUsd: 0.05 });
    expect(set.ok).toBe(true);
    const res = await handleAgentRun(
      { message: "开始", mode: "auto", sessionId: "s-plain" },
      { workspace, sessionId: "s-plain", logPath, unattended: false },
    );
    expect(res.ok, "run 失败诊断：" + JSON.stringify(res)).toBe(true);
    const evts = await events();
    const stops = evts.filter((e) => e.type === "goal_stopped");
    expect(stops.length).toBe(1);
    const reason = stops[0]?.type === "goal_stopped" ? stops[0].reason : "";
    expect(reason).toContain("美元上限");
    // 闸惰掉时会退到下一条理由——这两条"不许出现"就是本用例的分辨力所在
    expect(reason).not.toContain("轮次上限");
    expect(reason).not.toContain("没有写过任何文件");
    expect(userTurns(evts).filter((t) => t.type === "user_message" && t.origin?.kind === "goal").length).toBe(0);
  });
});

// ---- 盘上的方案门（任务 #14）：`over.planRequired ?? settings.planRequiredByDefault` 的**右半边** ----
// J3 那格给的是 override（`planRequired: true`），所以整行换成 `?? false` 全表照绿——而用户在设置界面
// 点的正是盘上那个键。放在文件最后：它会把 settings 单例改指本用例的临时文件（同上面美元闸的规矩）。
describe("方案门的 settings 半边：盘上打开即武装（不给 override）", () => {
  it("settings.planRequiredByDefault=true ⇒ 生产入口自己就该拒写，且拒因来自方案门", async () => {
    await script(
      '{"type":"tool_call","id":"w1","name":"write_file","args":{"path":"j4-probe.ts","content":"export const x = 1;\\n"}}\n' +
        TEXT_ONLY,
    );
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    initSettingsStore(join(root, "settings-plan-required.json"));
    await setSettings({ planRequiredByDefault: true });
    logPath = pathOf(sessions, "s-plan-from-settings");
    const res = await handleAgentRun(
      { message: "写个文件", mode: "auto", sessionId: "s-plan-from-settings" },
      { workspace, sessionId: "s-plan-from-settings", logPath, unattended: true }, // 一个 planRequired 都不传
    );
    expect(res.ok).toBe(true);
    const hit = (await events()).find((e) => e.type === "tool_result" && e.callId === "w1");
    const wrote = hit?.type === "tool_result" ? hit.ok : true;
    expect(wrote, "盘上的 true 没穿过 `over ?? settings` ⇒ 设置里「每轮先出计划」是空的（写照样放行）").toBe(false);
    expect(hit?.type === "tool_result" ? hit.output : "", "拒了但不点名方案门 = 是别的闸在答话").toContain("方案门");
    await expect(access(join(workspace, "j4-probe.ts"))).rejects.toThrow();
  });
});
