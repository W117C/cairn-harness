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
import { handleSessionSetArchived, handleSessionSetPinned } from "../../../src/main/session-handlers";

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

// 2026-10-19：sidecar 是单例根（装配根）的仓库，旧实现把同一份 metadataById 套到所有工作区；
// id 是秒级时间戳，两工作区同秒外部创建的会话可同名 ⇒ A 的 pinned/title 套到 B。
describe("跨工作区同 id 不串 sidecar", () => {
  it("只对装配根的会话合并组织字段", async () => {
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
    // 同名 id 两个登记根都有 ⇒ 归属解析必须拒绝（不猜第一个根，也就不写任何一边的 sidecar）。
    await expect(handleSessionSetPinned(id, true)).rejects.toThrow(/多个工作区/);
    const listed = await h2.listSessions();
    const a = listed.find((s) => s.workspace === canonicalWorkspacePath(wsA) && s.id === id);
    const b = listed.find((s) => s.workspace === canonicalWorkspacePath(wsB) && s.id === id);
    expect(a?.pinned).toBeUndefined(); // 同 id 无法归属 ⇒ 两边都不套 sidecar（fail-safe）
    expect(b?.pinned).toBeUndefined();
  });
});
