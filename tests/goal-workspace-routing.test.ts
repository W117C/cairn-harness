// goal 写入的**落点**判卷：`goal_set` / `goal_stopped` 必须进目标会话自己的日志。
// 旧形状读单例会话根（= 启动时的 activeWorkspace）⇒ 项目工作区里 `/goal` 会把目标写进默认工作区：
// 侧栏多一个只含 goal_set 的幽灵会话，而真会话从未被武装（续跑判据读真会话，live 事件却按 id
// 归给真会话 ⇒ 界面说「续跑中」、盘上没目标）。
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replay } from "../src/events";
import { handleGoalSet, initSessionsDir } from "../src/main/agent-runner";
import { pathOf } from "../src/main/sessions";
import { setSessionRootResolver } from "../src/main/session-handlers";

let root = "";
/** 启动工作区（单例根）：旧形状把所有人的目标都写到这里。 */
let bootRoot = "";
/** 项目工作区：目标真正该落的地方。 */
let projectRoot = "";

const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "goal-routing-"));
  bootRoot = join(root, "boot", ".agent", "sessions");
  projectRoot = join(root, "project", ".agent", "sessions");
  await mkdir(bootRoot, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  initSessionsDir(bootRoot);
  setSessionRootResolver(async (id) => {
    if (id === "s-project") return projectRoot;
    if (id === "s-ambiguous") throw new Error("会话 id 在多个工作区同时存在，必须显式指定 workspace");
    return null;
  });
});

afterEach(async () => {
  setSessionRootResolver(null);
  await rm(root, { recursive: true, force: true });
});

describe("goal 写入落进目标会话自己的工作区", () => {
  it("项目会话的 /goal：写进项目根，启动根不许多出幽灵会话", async () => {
    const r = await handleGoalSet({ sessionId: "s-project", objective: "把测试修绿", maxTurns: 6 });
    expect(r.ok).toBe(true);
    const events = await replay(pathOf(projectRoot, "s-project"));
    expect(events.map((e) => e.type)).toEqual(["goal_set"]);
    expect(await exists(pathOf(bootRoot, "s-project"))).toBe(false);
  });

  it("显式 sessionsRoot 优先于归属解析器：同名 id 两工作区时只写指定那个", async () => {
    const r = await handleGoalSet({ sessionId: "s-ambiguous", sessionsRoot: projectRoot, objective: "只改项目那份" });
    expect(r.ok).toBe(true);
    expect((await replay(pathOf(projectRoot, "s-ambiguous"))).map((e) => e.type)).toEqual(["goal_set"]);
    expect(await exists(pathOf(bootRoot, "s-ambiguous"))).toBe(false);
  });

  it("归属未知 ⇒ 拒绝写入，不回落单例根（回落 = 往别人的日志里写）", async () => {
    const r = await handleGoalSet({ sessionId: "s-unknown", objective: "无处可挂" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("无处可挂");
    expect(await exists(pathOf(bootRoot, "s-unknown"))).toBe(false);
  });

  it("归属歧义 ⇒ 拒绝（解析器抛错照常上抛成 ok:false），不猜一个根写下去", async () => {
    const r = await handleGoalSet({ sessionId: "s-ambiguous", objective: "歧义就拒绝" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("多个工作区");
    expect(await exists(pathOf(bootRoot, "s-ambiguous"))).toBe(false);
  });

  it("暂停/清除与设目标同一落点：clear 也只写项目会话那份", async () => {
    await handleGoalSet({ sessionId: "s-project", objective: "把测试修绿", maxTurns: 6 });
    const cleared = await handleGoalSet({ sessionId: "s-project", clear: true });
    expect(cleared.ok).toBe(true);
    expect((await replay(pathOf(projectRoot, "s-project"))).map((e) => e.type)).toEqual(["goal_set", "goal_stopped"]);
    expect(await exists(pathOf(bootRoot, "s-project"))).toBe(false);
  });
});
