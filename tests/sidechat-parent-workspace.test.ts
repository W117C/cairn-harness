// sidechat 的工作区必须跟着**父会话**走，不是「最近一次 run 的工作区」。
// 旧缺陷（2026-10-21 独立评审）：在项目 B 打开会话、却没在 B 跑过 run 时，currentWorkspace 仍是 A
// ⇒ 旁路的权限规则、@ 引用、主会话投影全落在 A。一个项目的问题被另一个项目的文件回答。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventLog } from "../src/events";
import { initSessionsDir, setSessionRootResolver } from "../src/main/session-handlers";
import { workspaceOfSessionsRoot } from "../src/main/sessions";
import { initSettingsStore } from "../src/main/settings-handlers";
import {
  handleSidechatAsk, handleSidechatCreate, handleSidechatPromote, handleSidechatState, setSidechatHandlerDeps,
} from "../src/main/sidechat-handlers";
import { setRunWorkspace } from "../src/main/runner-workspace";
import { scriptedSidechatModel } from "../src/agent/sidechat";
import type { GlmMessage } from "../src/providers/glm";

let dir: string;
let wsA: string;
let wsB: string;

const sessionsRoot = (ws: string) => join(ws, ".agent", "sessions");

beforeEach(async () => {
  dir = await mkdtemp(join(process.env.PI_SCRATCH_DIR ?? tmpdir(), "sidechat-parent-ws-"));
  wsA = join(dir, "project-a");
  wsB = join(dir, "project-b");
  await mkdir(sessionsRoot(wsA), { recursive: true });
  await mkdir(sessionsRoot(wsB), { recursive: true });
  await writeFile(join(wsA, "note.txt"), "A-CONTENT", "utf8");
  await writeFile(join(wsB, "note.txt"), "B-CONTENT", "utf8");
  // 父会话住在 B；B 的日志里有一句只属于 B 的话，用来证明主会话投影也没读错项目。
  await createEventLog(join(sessionsRoot(wsB), "parent-b.jsonl")).append({
    type: "user_message", content: "父会话在 B",
  });
  initSessionsDir(sessionsRoot(wsA));
  initSettingsStore(join(dir, "settings.json"));
  setSessionRootResolver(async (id) => (id === "parent-b" ? sessionsRoot(wsB) : null));
  // 「最近一次 run」仍是 A：这正是旧实现会拿错的那一格。
  setRunWorkspace(wsA);
  setSidechatHandlerDeps({
    onEvent: () => undefined,
    lastLogPath: () => null,
    currentWorkspace: async () => wsA,
  });
  vi.stubEnv("M2F_SIDECHAT_DEMO", "0");
});

afterEach(async () => {
  setRunWorkspace(null);
  setSessionRootResolver(null);
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("会话根 → 工作区", () => {
  it("标准布局 <ws>/.agent/sessions ⇒ 工作区；其它根 ⇒ null（不把 /tmp 当项目）", () => {
    expect(workspaceOfSessionsRoot(join(dir, "project-a", ".agent", "sessions"))).toBe(join(dir, "project-a"));
    expect(workspaceOfSessionsRoot(join(dir, "custom-run", "sessions"))).toBeNull();
    expect(workspaceOfSessionsRoot(join(dir, "project-a"))).toBeNull();
  });
});

describe("sidechat 的父会话工作区", () => {
  it("@ 引用走同一只读门：大小写变体、宿主配置、项目 deny 都进不来", async () => {
    await writeFile(join(wsB, ".ENV"), "ENV-SECRET", "utf8");
    await writeFile(join(wsB, ".agent", "config.json"), "CONFIG-SECRET", "utf8");
    await writeFile(join(wsB, ".agent", "permissions.json"), JSON.stringify({
      rules: [{ behavior: "deny", tool: "read_file", scope: "always" }],
    }), "utf8");
    const { id } = await handleSidechatCreate("parent-b");
    const captured: GlmMessage[][] = [];
    const res = await handleSidechatAsk(id, "@.ENV @.agent/config.json @note.txt", {
      parentSessionId: "parent-b",
      model: scriptedSidechatModel([{ type: "assistant_message", content: "答" }], captured),
    });
    expect(res.ok, res.error).toBe(true);
    const text = captured.flat().map((m) => m.content ?? "").join("\n");
    // macOS 的 APFS 缺省大小写不敏感：.ENV 打开的就是 .env。
    expect(text).not.toContain("ENV-SECRET");
    // .agent/config.json 是宿主命令面；读写都不该经 @ 引用直达上下文。
    expect(text).not.toContain("CONFIG-SECRET");
    // 项目规则 deny read_file ⇒ @ 引用不能绕过去。
    expect(text).not.toContain("B-CONTENT");
  });

  it("/promote 写回父会话所在的 B，不在启动工作区 A 造幽灵会话", async () => {
    const { id } = await handleSidechatCreate("parent-b");
    const res = await handleSidechatPromote({
      sidechatId: id,
      parentSessionId: "parent-b",
      sourceEventIds: [1],
      content: "跨区结论",
    });
    expect(res.ok, res.error).toBe(true);
    expect(await readFile(join(sessionsRoot(wsB), "parent-b.jsonl"), "utf8")).toContain("跨区结论");
    // 旧实现会往 A 的 <parent-b>.jsonl 追加一条只有 promote 的幽灵会话。
    await expect(readFile(join(sessionsRoot(wsA), "parent-b.jsonl"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    // 面板的已提升记录也必须从父会话根投影，不能读 A。
    const snap = await handleSidechatState("parent-b");
    expect(snap.promoted.some((p) => p.sessionId === id)).toBe(true);
  });

  it("父会话在 B ⇒ @ 引用与主会话投影都读 B，不读最近 run 的 A", async () => {
    const { id } = await handleSidechatCreate("parent-b");
    const captured: GlmMessage[][] = [];
    const res = await handleSidechatAsk(id, "看看 @note.txt", {
      parentSessionId: "parent-b",
      model: scriptedSidechatModel([{ type: "assistant_message", content: "答" }], captured),
    });
    expect(res.ok, res.error).toBe(true);
    const text = captured.flat().map((m) => m.content ?? "").join("\n");
    expect(text).toContain("B-CONTENT");
    expect(text).not.toContain("A-CONTENT");
    expect(text).toContain("父会话在 B");
  });
});
