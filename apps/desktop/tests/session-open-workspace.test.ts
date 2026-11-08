// 打开会话的 workspace 必须从 UI 一路穿到 host：只按 id 开会在同名 id 时打开另一个项目。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("openSession 的 workspace 接线", () => {
  it("协议面接受可选 workspace，main 转交 host", () => {
    expect(read("../../../src/main/ipc-protocol.ts")).toContain("openSession(id: string, workspace?: string)");
    expect(read("../src/main/index.ts")).toContain(
      "openSession: (id, workspace) => host.openSession(id as string, workspace as string | undefined)",
    );
  });

  it("renderer 显式传入决定的工作区，缺省才按 id 查", () => {
    const app = readAppSurface();
    expect(app).toContain("const sessionWs = workspace ?? findSessionByRef(");
    expect(app).toContain("window.agent.openSession(id, sessionWs ?? undefined)");
    expect(app).toContain("openSession(decision.id, decision.workspace ?? undefined)");
  });

  it("侧栏与命令面板把会话行的 workspace 一起交出去", () => {
    expect(read("../src/renderer/components/Sidebar.tsx")).toContain("props.onOpen(s.id, s.workspace)");
    expect(read("../src/renderer/components/CommandPalette.tsx")).toContain("props.onOpenSession(s.id, s.workspace)");
  });
});
