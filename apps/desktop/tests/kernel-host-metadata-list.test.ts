// 第三遍真机复检勘定 → 回归锚：kernel-host.listSessions 合并单例 sidecar 的 pinned/archived。
// 缺陷原形（真机实证）：core listSessions 只在传 metadataById 时合并组织字段，kernel-host 此前
// 不传 ⇒ 固定/归档**写入成功但清单读回永久丢**——行菜单点「固定」后菜单文案不翻、「已固定」筛选恒空。
// 本判卷钉读回闭环（写路径同源：handleSessionSetPinned/Archived 的会话 metadata 单例）：
//   ① 未组织过的会话：pinned/archived 缺省不出现（不补造假字段——core 的「不补造」契约）；
//   ② 固定/归档写入后 listSessions 原样带出；取消后带出 false（记录在场，只是翻假）。
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createKernelHost, canonicalWorkspacePath } from "../src/main/kernel-host";
import {
  handleSessionSetArchived,
  handleSessionSetPinned,
  requireSessionMetadataFor,
} from "../../../src/main/session-handlers";

const dir = mkdtempSync(join(tmpdir(), "cairn-host-md-"));
const workspace = join(dir, "ws");
mkdirSync(workspace, { recursive: true });
const userData = join(dir, "userData");
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));

const host = createKernelHost({
  workspaces: [workspace],
  activeWorkspace: workspace,
  userDataDir: userData,
  outbox: () => undefined,
});

describe("listSessions × 会话 metadata 合并（第三遍真机复检勘定回归）", () => {
  it("createSession 回传实际归属工作区（空屏默认工作区路径的采纳依据）", async () => {
    const created = await host.createSession();
    expect(created.workspace).toBe(canonicalWorkspacePath(workspace));
    const listed = (await host.listSessions()).find((s) => s.id === created.id);
    expect(listed?.workspace).toBe(canonicalWorkspacePath(workspace));
  });

  it("未组织过：pinned/archived 不出现（不补造假字段）", async () => {
    const { id } = await host.createSession();
    const listed = (await host.listSessions()).find((s) => s.id === id);
    expect(listed).toBeDefined();
    expect(listed?.pinned).toBeUndefined();
    expect(listed?.archived).toBeUndefined();
  });

  it("固定/归档写入 → 读回 true；取消 → 读回 false（走同一 sidecar）", async () => {
    const { id } = await host.createSession();
    await handleSessionSetPinned(id, true);
    let listed = (await host.listSessions()).find((s) => s.id === id);
    expect(listed?.pinned).toBe(true);

    await handleSessionSetArchived(id, true);
    listed = (await host.listSessions()).find((s) => s.id === id);
    expect(listed?.archived).toBe(true);
    expect(listed?.pinned).toBe(true); // 两个字段同记录，互不覆盖

    await handleSessionSetArchived(id, false);
    await handleSessionSetPinned(id, false);
    listed = (await host.listSessions()).find((s) => s.id === id);
    expect(listed?.pinned).toBe(false);
    expect(listed?.archived).toBe(false);
  });
});

// 2026-11-15：metadata 已按会话根分卷。同 id 一样有两条会话，但组织事实各归各的卷；
// 迁移前没有 workspaceScoped 标记的旧全局记录仍是唯一例外：归属不明时两边都不套。
describe("跨工作区同 id 的 metadata 按根隔离", () => {
  it("显式根写入只影响这一行", async () => {
    const root2 = mkdtempSync(join(tmpdir(), "cairn-host-md2-"));
    const wsA = join(root2, "a");
    const wsB = join(root2, "b");
    const userData2 = join(root2, "userData");
    for (const ws of [wsA, wsB]) mkdirSync(join(ws, ".agent", "sessions"), { recursive: true });
    mkdirSync(userData2, { recursive: true });
    writeFileSync(join(userData2, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));
    const id = "same-second-id";
    for (const ws of [wsA, wsB]) {
      writeFileSync(join(ws, ".agent", "sessions", id + ".jsonl"), JSON.stringify({ type: "user_message", content: "x" }) + "\n");
    }
    const h2 = createKernelHost({ workspaces: [wsA, wsB], activeWorkspace: wsA, userDataDir: userData2, outbox: () => undefined });
    const metaA = requireSessionMetadataFor(join(wsA, ".agent", "sessions"));
    const metaB = requireSessionMetadataFor(join(wsB, ".agent", "sessions"));
    await metaA.setTitle(id, "A 的标题");
    await metaB.setTitle(id, "B 的标题");
    // 同名 id 两个登记根都有 ⇒ 不带 workspace 的归属解析必须拒绝（不猜第一个根）。
    await expect(handleSessionSetPinned(id, true)).rejects.toThrow(/多个工作区/);
    await handleSessionSetPinned(id, true, join(wsA, ".agent", "sessions"));
    await handleSessionSetArchived(id, true, join(wsB, ".agent", "sessions"));

    const listed = await h2.listSessions();
    const a = listed.find((s) => s.workspace === canonicalWorkspacePath(wsA) && s.id === id);
    const b = listed.find((s) => s.workspace === canonicalWorkspacePath(wsB) && s.id === id);
    expect(a).toMatchObject({ title: "A 的标题", pinned: true, archived: false });
    expect(b).toMatchObject({ title: "B 的标题", pinned: false, archived: true });
  });

  it("迁移前的重复 id 记录没有根标记 ⇒ 两边都不套", async () => {
    const root2 = mkdtempSync(join(tmpdir(), "cairn-host-md3-"));
    const wsA = join(root2, "a");
    const wsB = join(root2, "b");
    const userData2 = join(root2, "userData");
    for (const ws of [wsA, wsB]) mkdirSync(join(ws, ".agent", "sessions"), { recursive: true });
    mkdirSync(userData2, { recursive: true });
    writeFileSync(join(userData2, "settings.json"), JSON.stringify({ provider: "demo", model: "" }));
    const id = "legacy-same-id";
    for (const ws of [wsA, wsB]) {
      writeFileSync(join(ws, ".agent", "sessions", id + ".jsonl"), JSON.stringify({ type: "user_message", content: "x" }) + "\n");
    }
    const stamp = "2026-01-01T00:00:00.000Z";
    writeFileSync(join(wsA, ".agent", "sessions", "session-metadata.json"), JSON.stringify({
      version: 1,
      sessions: {
        [id]: {
          id, title: "归属不明", pinned: true, archived: false, createdAt: stamp, updatedAt: stamp,
        },
      },
    }) + "\n");
    const h2 = createKernelHost({ workspaces: [wsA, wsB], activeWorkspace: wsA, userDataDir: userData2, outbox: () => undefined });
    const listed = await h2.listSessions();
    const a = listed.find((s) => s.workspace === canonicalWorkspacePath(wsA) && s.id === id);
    const b = listed.find((s) => s.workspace === canonicalWorkspacePath(wsB) && s.id === id);
    expect(a).not.toHaveProperty("pinned");
    expect(a).not.toHaveProperty("title");
    expect(b).not.toHaveProperty("pinned");
    expect(b).not.toHaveProperty("title");
  });
});
