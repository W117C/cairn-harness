// 记忆导出判卷（2026-10-30 · 第 824 页）：
// 导出是数据可携带性，不是截图：两层分节、主题元信息与正文、空层/空正文都有显式回落。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { memoryExportMarkdown } from "../src/renderer/memory-view";

const base = {
  project: { path: "/ws/.agent/memory", index: "# index", pendingExternalRefs: [], topics: [
    { topic: "build-notes", type: "project", modified: "2026-10-30T01:02:03.000Z", bytes: 12, body: "line one\nline two" },
  ] },
  global: { path: "/home/.cairn/memory", index: null, pendingExternalRefs: [], topics: [] },
} as unknown as Parameters<typeof memoryExportMarkdown>[0];

describe("memoryExportMarkdown", () => {
  it("两层分节；主题带类型/修改/大小/正文；空层不摆空壳", () => {
    const md = memoryExportMarkdown(base, "2026-10-30T00:00:00.000Z");
    expect(md).toContain("# Cairn 记忆导出");
    expect(md).toContain("生成时间：2026-10-30T00:00:00.000Z");
    expect(md).toContain("## 项目层");
    expect(md).toContain("### build-notes");
    expect(md).toContain("- 类型：project");
    expect(md).toContain("line one\nline two");
    expect(md).toContain("### 索引");
    expect(md).toContain("# index");
    expect(md).toContain("## 全局层");
    expect(md).toContain("_本层暂无主题_");
  });

  it("页面按钮真的走 exportMemory，不是只摆一个 chip", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/AppPage.tsx", import.meta.url)), "utf8");
    expect(src).toContain("window.agent.exportMemory(memoryExportMarkdown(memory), \"cairn-memory.md\")");
    expect(src).toContain('导出记忆…');
  });
});
