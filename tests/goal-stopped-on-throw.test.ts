// goal 模式「异常收场」的判卷（台账 #69 的一半）。
//
// 钉的是这一条事实：run 中途抛了 ⇒ 那条 run 已经死了，而芯片读的是事件流投影（projectGoal）。
// 盘上没有 goal_stopped 就等于界面对用户说「还在续跑」——把没发生的事报成在发生，
// 与本仓「不可知不许当免费」是同一条纪律。所以判据必须是**盘上真落了那一条**，
// 而不是返回值里带了 error。
//
// 为什么走生产入口（handleAgentRun）而不是手工造一份输入：goal_set 由 handleGoalSet 真写、
// 抛错由真 runLoop→provider 那一条链产出，被量对象与判卷看的是同一份 JSONL。
// 剧本走 M3A_MAIN_SCRIPT 显式通道（fixtures/mock 是冻结判卷文件，不往里加东西）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replay, type AgentEvent } from "../src/events";
import { handleAgentRun, handleGoalSet, initSessionsDir, initSettingsStore } from "../src/main/agent-runner";
import { pathOf } from "../src/main/sessions";
import { projectGoal } from "../src/agent/goal";

let root = "";
let workspace = "";
let sessions = "";
let scriptPath = "";
let logPath = "";

const TEXT_ONLY = '{"type":"assistant_message","content":"我说完了。"}\n';
// 一条必然抛的剧本：mock provider 的剧本格式闸只收 assistant_message/tool_call/usage/
// turn_truncated/round_end，其余当场抛（mock.ts:88）。它抛在**第一轮请求的流里**，
// 于是 user_message 已经在盘上、run 却再也走不到续跑判据——正是这条缺陷的现场形状。
const THROWS = '{"type":"tool_result","callId":"boom","ok":true,"output":"这不是模型输出"}\n';

async function script(raw: string): Promise<void> {
  await writeFile(scriptPath, raw, "utf8");
}

async function events(): Promise<AgentEvent[]> {
  return replay(logPath);
}

const stopsOf = (evts: AgentEvent[]): AgentEvent[] => evts.filter((e) => e.type === "goal_stopped");
const reasonOf = async (): Promise<string> => {
  const stop = stopsOf(await events())[0];
  return stop?.type === "goal_stopped" ? stop.reason : "";
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "goal-throw-"));
  workspace = join(root, "ws");
  sessions = join(root, "sessions");
  scriptPath = join(root, "script.jsonl");
  await mkdir(sessions, { recursive: true });
  await mkdir(workspace, { recursive: true });
  initSessionsDir(sessions);
  initSettingsStore(join(root, "settings.json")); // 缺省那份落在 /tmp 且跨用例共享 ⇒ 自己指一份
  logPath = pathOf(sessions, "s-goal");
  await script(TEXT_ONLY);
});

afterEach(async () => {
  delete process.env.M3A_MAIN_SCRIPT;
  await rm(root, { recursive: true, force: true });
});

describe("goal 模式异常收场：抛了就必须把「不跑了」落进事件流", () => {
  it("run 中途抛 ⇒ 盘上恰有一条点名异常的 goal_stopped，投影读得到 stopped", async () => {
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    await script(THROWS);
    await handleGoalSet({ sessionId: "s-goal", objective: "把测试修绿", maxTurns: 8 });
    const res = await handleAgentRun(
      { message: "开始", mode: "auto", sessionId: "s-goal" },
      { workspace, sessionId: "s-goal", logPath, unattended: false },
    );
    // 原异常没被吞：是 runAgent 把它照常抛了出去，入口的既有收场路径才报得出这份 error
    // （catch 里落完 goal_stopped 就把它自己咽了的话，这里会读到 ok:true）。
    expect(res.ok, "异常被吞成了正常收场：" + JSON.stringify(res)).toBe(false);
    expect(res.error ?? "").toContain("mock fixture 只允许");

    const evts = await events();
    expect(evts.some((e) => e.type === "user_message"), "抛之前那一轮没真跑到 ⇒ 这条判卷在验空表").toBe(true);
    const stops = stopsOf(evts);
    expect(stops.length).toBe(1);
    const reason = stops[0]?.type === "goal_stopped" ? stops[0].reason : "";
    // 理由要点名「异常收场」这一支，而不是任何别的停机理由（被顶掉＝落的是别人那条路）。
    expect(reason).not.toBe("");
    expect(reason).toContain("run 中途抛错");
    expect(reason).toContain("没走到续跑判据");
    // 而且要点名**这次抛的是什么**：只有固定前缀的话，用户照样不知道死因。
    expect(reason).toContain("mock fixture 只允许");
    // 分辨力：三条既有停机理由都不许出现在这一条上。
    expect(reason).not.toContain("无人值守 run 不自动续跑");
    expect(reason).not.toContain("没有写过任何文件");
    expect(reason).not.toContain("已用尽而目标未达成");

    // 芯片/转录那一头读的是投影，不是返回值：stopped 不许还是 null。
    const view = projectGoal(evts);
    expect(view?.stopped, "盘上有 goal_stopped 而投影读不到＝第二事实源").not.toBeNull();
    expect(view?.stopped).toContain("run 中途抛错");
    expect(view?.turn).toBe(1);
  });

  it("回归证人：正常收束与未武装目标都不许多落一条（异常那一支不许在没抛错时说话）", async () => {
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    // 支一：有目标、run 正常跑完、判据按「没写过任何文件」停 ⇒ 全流只那一条，
    // 且理由不许被异常那一支污染（写了 catch 却把正常路径也当异常收场）。
    await handleGoalSet({ sessionId: "s-goal", objective: "把测试修绿", maxTurns: 8 });
    const normal = await handleAgentRun(
      { message: "开始", mode: "auto", sessionId: "s-goal" },
      { workspace, sessionId: "s-goal", logPath, unattended: false },
    );
    expect(normal.ok, "正常收场被误报成失败：" + JSON.stringify(normal)).toBe(true);
    const evts = await events();
    expect(stopsOf(evts).length).toBe(1);
    expect(await reasonOf()).toContain("没有写过任何文件");
    expect(await reasonOf()).not.toContain("run 中途抛错");

    // 支二：同样抛，但这一场**从没武装过目标** ⇒ 逐字零行为（不给不存在的目标凭空落一条停，
    // 那等于往转录里写一件没发生过的事）。
    logPath = pathOf(sessions, "s-nogoal");
    await script(THROWS);
    const blown = await handleAgentRun(
      { message: "开始", mode: "auto", sessionId: "s-nogoal" },
      { workspace, sessionId: "s-nogoal", logPath, unattended: false },
    );
    expect(blown.ok).toBe(false);
    const bare = await events();
    expect(bare.some((e) => e.type === "goal_set" || e.type === "goal_stopped")).toBe(false);
    expect(projectGoal(bare)).toBeNull();
  });

  it("已经停过就不许落第二条把理由洗掉：先清除目标再抛，盘上仍是那一条", async () => {
    process.env.M3A_MAIN_SCRIPT = scriptPath;
    await handleGoalSet({ sessionId: "s-goal", objective: "把测试修绿", maxTurns: 8 });
    const cleared = await handleGoalSet({ sessionId: "s-goal", clear: true });
    expect(cleared.ok).toBe(true);
    expect(stopsOf(await events()).length).toBe(1);
    expect(await reasonOf()).toContain("用户清除目标");

    await script(THROWS);
    const res = await handleAgentRun(
      { message: "接着做", mode: "auto", sessionId: "s-goal" },
      { workspace, sessionId: "s-goal", logPath, unattended: false },
    );
    expect(res.ok).toBe(false); // 抛照样抛（落事件不是把异常改判成不抛的理由）
    expect(res.error ?? "").toContain("mock fixture 只允许");
    const evts = await events();
    // 审计面上「停了几次」必须是真的：第二条会把「用户清除」这个既有理由洗掉。
    expect(stopsOf(evts).length).toBe(1);
    expect(await reasonOf()).toContain("用户清除目标");
    expect(await reasonOf()).not.toContain("run 中途抛错");
    expect(projectGoal(evts)?.stopped).toContain("用户清除目标");
  });
});
