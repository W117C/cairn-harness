import { existsSync } from "node:fs";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventLog, type AgentEvent } from "../../../src/events";
import { createSession, pathOf, readSessionEvents, sessionExists, workspaceOfSessionsRoot } from "../../../src/main/sessions";
import type { ImConnection, ImInboundMessage } from "../../../src/im/types";
import {
  defaultSessionsRoot,
  lastAssistantText,
  routeImInbound,
  type DesktopImRouteDeps,
} from "../src/main/im-host";

let root: string | null = null;

afterEach(async () => {
  if (root !== null) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("IM 默认会话根", () => {
  it("落在真实 workspace 的 .agent/sessions，并可反推原 workspace", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-root-"));
    const workspace = join(root, "workspace");
    const sessionsRoot = defaultSessionsRoot(workspace);

    expect(sessionsRoot).toBe(join(workspace, ".agent", "sessions"));
    await createSession(sessionsRoot);
    expect(workspaceOfSessionsRoot(sessionsRoot)).toBe(workspace);
  });
});

describe("IM 本轮回复边界", () => {
  it("没有本轮新 assistant 时返回 null，不重发历史最后一句", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-reply-"));
    const sessionId = await createSession(root);
    const log = createEventLog(pathOf(root, sessionId));
    await log.append({ type: "assistant_message", content: "历史回复" } as AgentEvent);

    expect(await lastAssistantText(root, sessionId, 1)).toBeNull();

    await log.append({ type: "assistant_message", content: "本轮回复" } as AgentEvent);
    expect(await lastAssistantText(root, sessionId, 1)).toBe("本轮回复");
  });
});

function connection(): ImConnection {
  return {
    id: "im_route_test",
    platform: "feishu",
    account: null,
    sessionId: "",
    settings: {},
    secretKeys: {},
    enabled: true,
    paired: [],
    requests: [],
    chats: {},
    createdAt: 0,
  };
}

function inbound(): ImInboundMessage {
  return {
    chat: { key: "chat-1", kind: "direct", title: "测试聊天" },
    sender: { id: "user-1", name: "测试用户" },
    text: "本轮问题",
    mentioned: true,
    messageId: "message-1",
  };
}

function routeDeps(overrides: Partial<DesktopImRouteDeps>): DesktopImRouteDeps {
  return {
    sessionsRoot: async () => { throw new Error("不应回落到缺省会话根"); },
    mode: async () => "default",
    run: async () => ({ ok: true }),
    hasWorkspace: () => false,
    save: async () => undefined,
    ...overrides,
  };
}

describe("IM 生产入站路由", () => {
  it("沿用已绑定会话；本轮没有新 assistant 时不重发历史回复", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-route-history-"));
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const sessionsRoot = defaultSessionsRoot(workspace);
    const sessionId = await createSession(sessionsRoot);
    await createEventLog(pathOf(sessionsRoot, sessionId)).append(
      { type: "assistant_message", content: "历史回复" } as AgentEvent,
    );
    const conn = { ...connection(), sessionId, workspace };
    const run = vi.fn(async () => ({ ok: true }));

    const result = await routeImInbound(conn, inbound(), routeDeps({
      run,
      hasWorkspace: (candidate) => candidate === workspace,
    }));

    expect(result).toEqual({ ok: true, reply: "" });
    expect(conn.sessionId).toBe(sessionId);
    expect(run).toHaveBeenCalledWith({ message: "本轮问题", mode: "default", sessionId, workspace });
    expect(await readSessionEvents(sessionsRoot, sessionId)).toEqual([
      expect.objectContaining({ type: "assistant_message", content: "历史回复" }),
    ]);
  });

  it("本轮 append 新 assistant 时只返回新文本", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-route-new-"));
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const sessionsRoot = defaultSessionsRoot(workspace);
    const sessionId = await createSession(sessionsRoot);
    const log = createEventLog(pathOf(sessionsRoot, sessionId));
    await log.append({ type: "assistant_message", content: "历史回复" } as AgentEvent);
    const conn = { ...connection(), sessionId, workspace };
    const run = vi.fn(async () => {
      await log.append({ type: "assistant_message", content: "本轮回复" } as AgentEvent);
      return { ok: true };
    });

    const result = await routeImInbound(conn, inbound(), routeDeps({
      run,
      hasWorkspace: (candidate) => candidate === workspace,
    }));

    expect(result).toEqual({ ok: true, reply: "本轮回复" });
    expect((await readSessionEvents(sessionsRoot, sessionId)).map((event) =>
      event.type === "assistant_message" ? event.content : undefined,
    )).toEqual(["历史回复", "本轮回复"]);
  });

  it("run 后会话日志缺失时拒绝路由，不伪装成无回复成功", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-route-missing-log-"));
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const sessionsRoot = defaultSessionsRoot(workspace);
    const sessionId = await createSession(sessionsRoot);
    const conn = { ...connection(), sessionId, workspace };
    const run = vi.fn(async () => {
      await rm(pathOf(sessionsRoot, sessionId));
      return { ok: true };
    });

    await expect(routeImInbound(conn, inbound(), routeDeps({
      run,
      hasWorkspace: (candidate) => candidate === workspace,
    }))).rejects.toMatchObject({ code: "ENOENT" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("已登记连接 workspace 决定新会话根，并把同一 workspace 交给 run", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-route-workspace-"));
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const expectedRoot = join(workspace, ".agent", "sessions");
    const fallbackRoot = join(root, "fallback-sessions");
    const sessionsRoot = vi.fn(async () => fallbackRoot);
    const save = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ ok: true }));
    const conn = { ...connection(), workspace };

    const result = await routeImInbound(conn, inbound(), routeDeps({
      sessionsRoot,
      run,
      hasWorkspace: (candidate) => candidate === workspace,
      save,
    }));

    expect(result).toEqual({ ok: true, reply: "" });
    expect(conn.sessionId).not.toBe("");
    expect(await sessionExists(expectedRoot, conn.sessionId)).toBe(true);
    expect(workspaceOfSessionsRoot(expectedRoot)).toBe(workspace);
    expect(existsSync(fallbackRoot)).toBe(false);
    expect(sessionsRoot).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      message: "本轮问题",
      mode: "default",
      sessionId: conn.sessionId,
      workspace,
    });
    expect(await readSessionEvents(expectedRoot, conn.sessionId)).toEqual([
      expect.objectContaining({ type: "session_meta_update", patch: { im: conn.id } }),
    ]);
  });

  it("已登记缺省根绑定并持久化 workspace，后续 run 显式使用它", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-route-fallback-bound-"));
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const sessionsRoot = defaultSessionsRoot(workspace);
    const sessionsRootDep = vi.fn(async () => sessionsRoot);
    const save = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ ok: true }));
    const conn = connection();

    const result = await routeImInbound(conn, inbound(), routeDeps({
      sessionsRoot: sessionsRootDep,
      run,
      hasWorkspace: (candidate) => candidate === workspace,
      save,
    }));

    expect(result).toEqual({ ok: true, reply: "" });
    expect(conn.workspace).toBe(workspace);
    expect(conn.sessionId).not.toBe("");
    expect(await sessionExists(sessionsRoot, conn.sessionId)).toBe(true);
    expect(sessionsRootDep).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      message: "本轮问题",
      mode: "default",
      sessionId: conn.sessionId,
      workspace,
    });
  });

  it("缺省根绑定的持久化载荷包含已解析 workspace", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-route-fallback-payload-"));
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const sessionsRoot = defaultSessionsRoot(workspace);
    const connectionsPath = join(root, "im", "connections.json");
    await mkdir(join(root, "im"), { recursive: true });
    const save = async (): Promise<void> => {
      await writeFile(connectionsPath, JSON.stringify([conn]), "utf8");
    };
    const conn = connection();

    const result = await routeImInbound(conn, inbound(), routeDeps({
      sessionsRoot: async () => sessionsRoot,
      hasWorkspace: (candidate) => candidate === workspace,
      save,
    }));

    expect(result).toEqual({ ok: true, reply: "" });
    const persisted = JSON.parse(await readFile(connectionsPath, "utf8")) as ImConnection[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.workspace).toBe(workspace);
  });

  it("缺省根所属 workspace 已移除时拒绝，不建会话不 run", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-route-fallback-removed-"));
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const sessionsRoot = defaultSessionsRoot(workspace);
    const save = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ ok: true }));
    const hasWorkspace = vi.fn(() => false);
    const conn = connection();

    const result = await routeImInbound(conn, inbound(), routeDeps({
      sessionsRoot: async () => sessionsRoot,
      run,
      hasWorkspace,
      save,
    }));

    expect(result).toEqual({ ok: false, error: "没有可用的会话根" });
    expect(hasWorkspace).toHaveBeenCalledWith(workspace);
    expect(conn.workspace).toBeUndefined();
    expect(conn.sessionId).toBe("");
    expect(existsSync(sessionsRoot)).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("复用缺省根下已有会话时仍持久化 workspace 绑定", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-route-fallback-existing-"));
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const sessionsRoot = defaultSessionsRoot(workspace);
    const sessionId = await createSession(sessionsRoot);
    const save = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ ok: true }));
    const conn = { ...connection(), sessionId };

    const result = await routeImInbound(conn, inbound(), routeDeps({
      sessionsRoot: async () => sessionsRoot,
      run,
      hasWorkspace: (candidate) => candidate === workspace,
      save,
    }));

    expect(result).toEqual({ ok: true, reply: "" });
    expect(conn.workspace).toBe(workspace);
    expect(conn.sessionId).toBe(sessionId);
    expect(save).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      message: "本轮问题",
      mode: "default",
      sessionId,
      workspace,
    });
  });

  it("缺省根绑定首次保存失败时保持未绑定，下次路由重试保存后只运行一次", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-route-fallback-save-retry-"));
    const workspace = join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const sessionsRoot = defaultSessionsRoot(workspace);
    const sessionId = await createSession(sessionsRoot);
    const saveError = new Error("保存连接失败");
    const save = vi.fn(async () => undefined).mockRejectedValueOnce(saveError);
    const run = vi.fn(async () => ({ ok: true }));
    const sessionsRootDep = vi.fn(async () => sessionsRoot);
    const conn = { ...connection(), sessionId };
    const deps = routeDeps({
      sessionsRoot: sessionsRootDep,
      run,
      hasWorkspace: (candidate) => candidate === workspace,
      save,
    });

    await expect(routeImInbound(conn, inbound(), deps)).rejects.toBe(saveError);
    expect(conn.workspace).toBeUndefined();
    expect(conn.sessionId).toBe(sessionId);
    expect(save).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();

    const result = await routeImInbound(conn, inbound(), deps);

    expect(result).toEqual({ ok: true, reply: "" });
    expect(conn.workspace).toBe(workspace);
    expect(conn.sessionId).toBe(sessionId);
    expect(sessionsRootDep).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({
      message: "本轮问题",
      mode: "default",
      sessionId,
      workspace,
    });
  });

  it("缺省根形状无法识别 workspace 时拒绝，不建会话不 run", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-route-fallback-shape-"));
    const sessionsRoot = join(root, "sessions");
    const save = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ ok: true }));
    const hasWorkspace = vi.fn(() => true);
    const conn = connection();

    const result = await routeImInbound(conn, inbound(), routeDeps({
      sessionsRoot: async () => sessionsRoot,
      run,
      hasWorkspace,
      save,
    }));

    expect(result).toEqual({ ok: false, error: "没有可用的会话根" });
    expect(hasWorkspace).not.toHaveBeenCalled();
    expect(conn.workspace).toBeUndefined();
    expect(conn.sessionId).toBe("");
    expect(existsSync(sessionsRoot)).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("同一时刻跨 workspace 并发首条消息使用不同会话 id，且 JSONL 只落在各自根", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-route-collision-"));
    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    const registered = new Set([workspaceA, workspaceB]);
    const connA = { ...connection(), id: "im_route_collision_a", workspace: workspaceA };
    const connB = { ...connection(), id: "im_route_collision_b", workspace: workspaceB };
    const roots = [defaultSessionsRoot(workspaceA), defaultSessionsRoot(workspaceB)];
    const messages = ["workspace-a 本轮回复", "workspace-b 本轮回复"];
    const replies = [
      { workspace: workspaceA, message: messages[0] },
      { workspace: workspaceB, message: messages[1] },
    ];
    const run: DesktopImRouteDeps["run"] = async (req) => {
      const reply = replies.find((entry) => entry.workspace === req.workspace);
      if (reply === undefined) throw new Error("run 收到未知 workspace");
      await createEventLog(pathOf(defaultSessionsRoot(reply.workspace), req.sessionId)).append(
        { type: "assistant_message", content: reply.message } as AgentEvent,
      );
      return { ok: true };
    };

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T10:15:00Z"));
    try {
      const results = await Promise.all([
        routeImInbound(connA, inbound(), routeDeps({ run, hasWorkspace: (workspace) => registered.has(workspace) })),
        routeImInbound(connB, inbound(), routeDeps({ run, hasWorkspace: (workspace) => registered.has(workspace) })),
      ]);

      expect(results).toEqual([
        { ok: true, reply: messages[0] },
        { ok: true, reply: messages[1] },
      ]);
      expect(connA.sessionId).not.toBe("");
      expect(connB.sessionId).not.toBe("");
      expect(connA.sessionId).not.toBe(connB.sessionId);
      for (const [at, conn] of [connA, connB].entries()) {
        const ownPath = pathOf(roots[at] ?? "", conn.sessionId);
        const otherPath = pathOf(roots[1 - at] ?? "", conn.sessionId);
        expect(existsSync(ownPath)).toBe(true);
        expect(existsSync(otherPath)).toBe(false);
        const jsonl = await readFile(ownPath, "utf8");
        expect(jsonl).toContain(messages[at]);
        expect(jsonl).not.toContain(messages[1 - at]);
        expect(await readSessionEvents(roots[at] ?? "", conn.sessionId)).toEqual([
          expect.objectContaining({ type: "session_meta_update", patch: { im: conn.id } }),
          expect.objectContaining({ type: "assistant_message", content: messages[at] }),
        ]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("未登记的连接 workspace 直接拒绝，不建会话也不 run", async () => {
    root = await mkdtemp(join(tmpdir(), "cairn-im-route-unregistered-"));
    const workspace = join(root, "unregistered");
    const fallbackRoot = join(root, "fallback-sessions");
    const sessionsRoot = vi.fn(async () => fallbackRoot);
    const save = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({ ok: true }));
    const hasWorkspace = vi.fn(() => false);
    const conn = { ...connection(), workspace };

    const result = await routeImInbound(conn, inbound(), routeDeps({
      sessionsRoot,
      run,
      hasWorkspace,
      save,
    }));

    expect(result).toEqual({ ok: false, error: "没有可用的会话根" });
    expect(hasWorkspace).toHaveBeenCalledWith(workspace);
    expect(conn.sessionId).toBe("");
    expect(existsSync(join(workspace, ".agent", "sessions"))).toBe(false);
    expect(existsSync(fallbackRoot)).toBe(false);
    expect(sessionsRoot).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
