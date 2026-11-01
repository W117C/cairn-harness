// 会话级模型/思考档持久化（v35）的渲染层判卷：
//  ① 回读只补本地还没有的键（用户当前选择优先）；
//  ② 有会话时换模型只写 sidecar，**不改全局缺省**（此前一处代码与它自己的注释相反）；
//  ③ 主页换模型只写全局缺省。
import { afterEach, describe, expect, it, vi } from "vitest";
import { applySessionModelPick, hydrateSessionPrefs } from "../src/renderer/state/session-prefs";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("hydrateSessionPrefs（列表 → 两张内存表）", () => {
  it("只补缺席：本地已有的选择不被列表打回旧值", () => {
    const selections = new Map<string, string | null>([["s1", "glm-5.3-flash"]]);
    const thinking = new Map<string, string>();
    const changed = hydrateSessionPrefs(
      [
        { id: "s1", model: "deepseek-chat", thinking: "high" },
        { id: "s2", model: "deepseek-chat" },
        { id: "s3" },
      ],
      selections,
      thinking,
    );
    expect(changed).toBe(true);
    expect(selections.get("s1")).toBe("glm-5.3-flash"); // 本地选择优先
    expect(thinking.get("s1")).toBe("high");
    expect(selections.get("s2")).toBe("deepseek-chat");
    expect(selections.has("s3")).toBe(false); // 缺席 = 跟随全局，不写空值
  });

  it("没有可补的键 ⇒ 返回 false（调用方不触发无意义重绘）", () => {
    const selections = new Map<string, string | null>([["s1", "deepseek-chat"]]);
    const thinking = new Map<string, string>([["s1", "high"]]);
    expect(hydrateSessionPrefs([{ id: "s1", model: "deepseek-chat", thinking: "high" }], selections, thinking)).toBe(false);
  });
});

describe("applySessionModelPick（有会话 = 只落会话；主页 = 只落全局）", () => {
  const makeWindow = () => {
    const sessionPrefsSet = vi.fn(async () => ({ ok: true }));
    const setSettings = vi.fn(async () => ({}));
    vi.stubGlobal("window", { agent: { sessionPrefsSet, setSettings } });
    return { sessionPrefsSet, setSettings };
  };

  it("有会话：写 selections + sessionPrefsSet，不碰全局设置", () => {
    const { sessionPrefsSet, setSettings } = makeWindow();
    const selections = new Map<string, string | null>();
    const force = vi.fn();
    const setLastError = vi.fn();
    applySessionModelPick({
      activeId: "s1", registryId: "glm-5.3-flash", selections: { current: selections }, force,
      providerInfo: null, refreshProviderInfo: async () => undefined, setLastError,
    });
    expect(selections.get("s1")).toBe("glm-5.3-flash");
    expect(force).toHaveBeenCalled();
    expect(sessionPrefsSet).toHaveBeenCalledWith("s1", { model: "glm-5.3-flash" });
    expect(setSettings).not.toHaveBeenCalled();
  });

  it("有会话且选回「跟随默认」(null)：sidecar 收到 null（摘掉这一格）", () => {
    const { sessionPrefsSet } = makeWindow();
    applySessionModelPick({
      activeId: "s1", registryId: null, selections: { current: new Map() }, force: () => undefined,
      providerInfo: null, refreshProviderInfo: async () => undefined, setLastError: () => undefined,
    });
    expect(sessionPrefsSet).toHaveBeenCalledWith("s1", { model: null });
  });

  it("主页：只写全局缺省（model + provider），不写会话 sidecar", () => {
    const { sessionPrefsSet, setSettings } = makeWindow();
    applySessionModelPick({
      activeId: null, registryId: "glm-5.3-flash", selections: { current: new Map() }, force: () => undefined,
      providerInfo: { models: [{ id: "glm-5.3-flash", provider: "glm" }] },
      refreshProviderInfo: async () => undefined, setLastError: () => undefined,
    });
    expect(setSettings).toHaveBeenCalledWith({ model: "glm-5.3-flash", provider: "glm" });
    expect(sessionPrefsSet).not.toHaveBeenCalled();
  });

  it("落盘失败要上屏（不吞成未处理 rejection）", async () => {
    const sessionPrefsSet = vi.fn(async () => { throw new Error("磁盘只读"); });
    vi.stubGlobal("window", { agent: { sessionPrefsSet, setSettings: vi.fn() } });
    const setLastError = vi.fn();
    applySessionModelPick({
      activeId: "s1", registryId: "glm-5.3-flash", selections: { current: new Map() }, force: () => undefined,
      providerInfo: null, refreshProviderInfo: async () => undefined, setLastError,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(setLastError).toHaveBeenCalledWith(expect.stringContaining("会话模型保存失败"));
  });
});

// 接线哨兵：钩子/回调真的挂在生产路径上（纯函数与回调单测之外的另一半）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
it("workbench 调回读钩子；WorkbenchView 的换模型/换思考都落会话 sidecar", () => {
  const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  expect(read("../src/renderer/state/workbench.ts"))
    .toContain("useSessionPrefsHydration({ sessions, selections, thinking: thinkingBySession, force });");
  const view = read("../src/renderer/panes/WorkbenchView.tsx");
  expect(view).toContain("onModelChange={(registryId) => applySessionModelPick({");
  expect(view).toContain("saveSessionPrefs(change.sessionId, { thinking: change.level }, activeWorkspace ?? undefined)");
});
