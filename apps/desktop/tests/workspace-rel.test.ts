// 事件绝对路径 → 工作区相对路径（2026-10-18）：macOS /tmp 与 /private/tmp 前缀不同但同一处，
// 真机上附件芯片因此误报「不在工作区内」。归一后比较；越界必须仍返回 null。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { relInWorkspace } from "../src/renderer/workspace-rel";

describe("relInWorkspace", () => {
  it("同一拼写与 /private 前缀差都归到相对路径", () => {
    expect(relInWorkspace("/ws", "/ws/a.txt")).toBe("a.txt");
    expect(relInWorkspace("/private/tmp/ws", "/tmp/ws/a.txt")).toBe("a.txt");
    expect(relInWorkspace("/tmp/ws/", "/tmp/ws/dir/b.txt")).toBe("dir/b.txt");
    expect(relInWorkspace("/ws", "/private/ws/a.txt")).toBe("a.txt");
  });

  it("工作区本身 → '.'；越界/空工作区 → null", () => {
    expect(relInWorkspace("/ws", "/ws")).toBe(".");
    expect(relInWorkspace("/ws", "/ws2/a.txt")).toBeNull();
    expect(relInWorkspace("/ws", "/other/a.txt")).toBeNull();
    expect(relInWorkspace(null, "/ws/a.txt")).toBeNull();
    expect(relInWorkspace("   ", "/ws/a.txt")).toBeNull();
  });

  it("反斜杠与盘符大小写归一", () => {
    expect(relInWorkspace("C:/Work", "c:\\Work\\a.txt")).toBe("a.txt");
  });
});

describe("Composer 附件与历史附件同口径（2026-10-18）", () => {
  it("inWorkspace 与 chip 点击都走 relInWorkspace", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/Composer.tsx", import.meta.url)), "utf8");
    expect(src).toContain('import { relInWorkspace } from "../workspace-rel";');
    expect(src).toContain("const inWorkspace = (p: string): boolean => relInWorkspace(wsPath, p) !== null;");
    expect(src).toContain("const rel = relInWorkspace(wsPath, a.path);");
    // 盾牌按归一后的包含关系现算，不读可能过时的 outside 标记
    expect(src).toContain("{!inWorkspace(a.path) && (");
  });
});
