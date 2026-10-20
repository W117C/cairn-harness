// 会话级 worktree 隔离的**接线**判卷（行为判卷在 tests/session-worktree.test.ts，属 core 面）。
//
// 为什么判针脚：创建/合并/清理都在 core 侧有真 git 判卷，但「run 真的跑进那棵树」只在
// kernel-host 里两行——它偏了不会红任何东西：树建得漂亮，run 还在主 checkout 里写。
// 这类"接上了但没人用"的缺口，本仓口径就是读源文点针脚（对面是 interaction-deadends / channels 一族）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("会话级 worktree 隔离接线（§3.7 · G4）", () => {
  it("run 真的会跑进隔离树（kernel-host 接线；接不上 = 建了也没人用）", () => {
    // 创建/合并都测过了，但「run 用那棵树」这件事在 kernel-host 里只有两行——
    // 它偏了不会红任何东西：树建得漂亮，run 还在主 checkout 里写。所以按仓库既有口径钉接线。
    const src = readFileSync(new URL("../src/main/kernel-host.ts", import.meta.url), "utf8");
    expect(src).toContain("const runWs = (await isSessionIsolated(ws, sessionId)) ? sessionWorktreePath(ws, sessionId) : ws;");
    expect(src).toContain("workspace: runWs");
    // 会话存储不受影响：logPath 仍钉在主 checkout 侧（不是 worktree 侧）
    expect(src).toContain("const logPath = pathOf(wsRoot(ws), sessionId);");
  });
});
