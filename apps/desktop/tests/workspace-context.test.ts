// 2026-10-17 真机实证：冷启动（本进程没跑过 run）打开旧会话，检查器「改动」报
// 「没有已知的工作区（本进程还没跑过 run）」；切项目后还会拿上一个 run 的根解析路径。
// 修法 = 渲染层上报活动工作区，主进程工作区类操作优先用它。这里钉住 override 真生效 + 接线。
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { handleWorkspaceListDir, handleWorkspaceReadText } from "../../../src/main/session-handlers";
import { memorySnapshot } from "../../../src/main/memory-handlers";
import { projectMemoryDir } from "../../../src/agent/memory/store";
import { readAppSurface } from "./helpers/app-surface";

const dir = mkdtempSync(join(tmpdir(), "cairn-wsctx-"));
mkdirSync(join(dir, "src"), { recursive: true });
writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n", "utf8");

describe("活动工作区上下文（override）", () => {
  it("override 生效：冷进程也能列目录 / 读文件（不靠最近一次 run）", async () => {
    const list = await handleWorkspaceListDir("", dir);
    expect(list.ok).toBe(true);
    expect(list.ok && list.entries.some((e) => e.name === "src")).toBe(true);

    const text = await handleWorkspaceReadText("src/a.ts", dir);
    expect(text.ok).toBe(true);
    expect(text.ok && text.text).toContain("export const a = 1;");
  });

  it("接线：协议/通道/主进程/渲染层四处都在", () => {
    const root = new URL("../../../", import.meta.url);
    const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, root)), "utf8");
    expect(read("src/main/ipc-protocol.ts")).toContain("setWorkspaceContext(path: string)");
    expect(read("apps/desktop/src/main/channels.ts")).toContain('setWorkspaceContext: "agent:set-workspace-context"');
    const main = read("apps/desktop/src/main/index.ts");
    expect(main).toContain("let workspaceContext: string | null = null");
    expect(main).toContain("resolveWorkspace");
    expect(main).toContain("handleChangeDiff(req as never, workspaceContext)");
    const app = readAppSurface();
    expect(app).toContain('window.agent.setWorkspaceContext(activeWorkspace ?? "")');
  });
});


describe("记忆快照的工作区层取活动工作区", () => {
  it("memorySnapshot(override) 的项目层路径 = 该工作区的 .agent/memory（不是 cwd）", async () => {
    const snap = await memorySnapshot(dir);
    expect(snap.project.path).toBe(projectMemoryDir(dir));
    expect(snap.project.path).not.toBe(projectMemoryDir(process.cwd()));
  });
});
