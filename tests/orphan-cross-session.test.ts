// 跨会话孤儿扫描的接线判卷（2026-10-23）。
//
// 形状：`.agents/wt-*` 是 **workspace 级**目录，而 `scanOrphanWorktrees` 只拿 `lastLogPath()` 这一个
// 会话的事件流判终态。多会话共用一个 workspace 时，另一会话仍在跑（或刚跑完待合并）的 worker
// 在当前会话日志里没有终态 ⇒ 旧实现会把它列进「可清理」，用户一点就把活树删了。
// 本判卷把 orchestrator 的归属集合 mock 成「w1 仍活着」，再喂一棵 `wt-w1`：
// 接线正确 ⇒ 不进面板；把 `new Set(ownedWorktreeAgentIds())` 换成 `new Set()` ⇒ 当场红。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/agent/orchestrator", () => ({
  ownedWorktreeAgentIds: () => ["w1"],
}));

import { scanOrphanWorktrees, setStateHandlerDeps } from "../src/main/state-handlers";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("scanOrphanWorktrees：跨会话活 worker 不许进「可清理」", () => {
  it("orchestrator 仍归属的 w1 ⇒ 即使本会话日志没有终态，也不列孤儿", async () => {
    const root = mkdtempSync(join(tmpdir(), "cairn-orphan-cross-"));
    roots.push(root);
    mkdirSync(join(root, ".agents", "wt-w1"), { recursive: true });
    const logPath = join(root, "empty.jsonl");
    writeFileSync(logPath, "", "utf8");
    setStateHandlerDeps({
      defaultWorkspace: () => root,
      sandboxState: () => ({}) as never,
      lastLogPath: () => logPath,
    });

    expect(await scanOrphanWorktrees(root)).toEqual([]);
  });
});
