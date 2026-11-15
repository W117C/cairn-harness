// 旁路（sidechat）的**工作区落点**判卷：新建/提问/提升/清单四处必须与父会话同根。
// 旧形状读单例会话根（= 启动时的 activeWorkspace）⇒ 在别的项目里开旁路，档案与清单都读写
// 默认工作区那一份：换个项目打开面板会看到另一个项目的旁路内容，提升也可能落在同 id 的错误会话上。
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog, replay } from "../src/events";
import { handleSidechatCreate, handleSidechatPromote, handleSidechatState, initSessionsDir } from "../src/main/agent-runner";
import { SIDECHAT_DIR, pathOf, sidechatEventsPath } from "../src/main/sessions";
import { setSessionRootResolver } from "../src/main/session-handlers";

let root = "";
let bootRoot = "";
let projectRoot = "";

const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sidechat-routing-"));
  bootRoot = join(root, "boot", ".agent", "sessions");
  projectRoot = join(root, "project", ".agent", "sessions");
  await mkdir(bootRoot, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  initSessionsDir(bootRoot);
  setSessionRootResolver(async (id) => {
    if (id === "parent-project") return projectRoot;
    if (id === "parent-ambiguous") throw new Error("会话 id 在多个工作区同时存在，必须显式指定 workspace");
    return null;
  });
  // 父会话要真实存在（ask/promote 都按文件存在与否 fail-closed）。
  await createEventLog(pathOf(projectRoot, "parent-project")).append({ type: "user_message", content: "主会话" });
});

afterEach(async () => {
  setSessionRootResolver(null);
  await rm(root, { recursive: true, force: true });
});

describe("旁路会话跟着父会话的工作区走", () => {
  it("新建的旁路档案落在项目根，启动根不多出一份", async () => {
    const { id } = await handleSidechatCreate("parent-project", "查一下");
    expect(await exists(sidechatEventsPath(projectRoot, id))).toBe(true);
    expect(await exists(sidechatEventsPath(bootRoot, id))).toBe(false);
  });

  it("清单按调用方的工作区列：别的项目的旁路不会串进来", async () => {
    const { id } = await handleSidechatCreate("parent-project", "只属于项目");
    const boot = await handleSidechatState(undefined, bootRoot);
    const project = await handleSidechatState(undefined, projectRoot);
    expect(boot.sessions.map((s) => s.id)).toEqual([]);
    expect(project.sessions.map((s) => s.id)).toContain(id);
  });

  it("不给显式根时按父会话归属列（父会话在项目根 ⇒ 列项目那份）", async () => {
    const { id } = await handleSidechatCreate("parent-project", "按父会话");
    const snap = await handleSidechatState("parent-project");
    expect(snap.parentSessionId).toBe("parent-project");
    expect(snap.sessions.map((s) => s.id)).toContain(id);
  });

  it("显式根优先于归属解析器（同名 id 歧义时仍能指定）", async () => {
    const { id } = await handleSidechatCreate("parent-ambiguous", "显式根", projectRoot);
    expect(await exists(sidechatEventsPath(projectRoot, id))).toBe(true);
    expect(await exists(sidechatEventsPath(bootRoot, id))).toBe(false);
  });

  it("父会话归属未知 ⇒ 拒绝新建，不回落单例根（回落 = 往别的项目写）", async () => {
    await expect(handleSidechatCreate("parent-unknown")).rejects.toThrow(/归属未知/);
    expect(await exists(join(bootRoot, SIDECHAT_DIR))).toBe(false);
  });

  it("提升：读项目根的旁路档案，只写父会话自己的日志", async () => {
    const { id } = await handleSidechatCreate("parent-project", "可提升");
    await createEventLog(sidechatEventsPath(projectRoot, id)).append({ type: "assistant_message", content: "结论：修这条" });
    const res = await handleSidechatPromote({
      sidechatId: id,
      parentSessionId: "parent-project",
      sourceEventIds: [2],
      note: "提升结论",
    });
    expect(res.ok).toBe(true);
    const events = await replay(pathOf(projectRoot, "parent-project"));
    const promoted = events.filter((e) => e.type === "user_message" && e.origin?.kind === "sidechat");
    expect(promoted).toHaveLength(1);
    expect(await exists(pathOf(bootRoot, "parent-project"))).toBe(false);
  });
});
