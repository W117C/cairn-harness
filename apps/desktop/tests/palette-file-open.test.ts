// 命令面板文件快速打开（2026-10-25）：
//   · 纯函数 ancestorDirsOf 决定父目录展开/懒加载面；
//   · 接线面：PaletteContent → onOpenFile → WorkbenchView（openPane + fileTarget）
//     → PaneDock（激活 file 标签）→ FilePane（展开父目录 + 打开预览）。
// 端到端由 interaction-smoke 用真实指针走：⌘K → 输入 → 选 src/main.ts → 预览到位。
import { expect, it } from "vitest";
import { ancestorDirsOf } from "../src/renderer/components/FilePane";
import { readRendererFile } from "./helpers/app-surface";

const palette = readRendererFile("components/CommandPalette.tsx");
const filePane = readRendererFile("components/FilePane.tsx");
const paneDock = readRendererFile("components/PaneDock.tsx");
const workbench = [
  readRendererFile("panes/WorkbenchView.tsx"),
  readRendererFile("panes/WorkbenchInspector.tsx"),
  readRendererFile("panes/WorkbenchOverlays.tsx"),
].join("\n");

it("ancestorDirsOf：只给父目录，顺序由浅到深；根目录文件返回空", () => {
  expect(ancestorDirsOf("README.md")).toEqual([]);
  expect(ancestorDirsOf("src/main.ts")).toEqual(["src"]);
  expect(ancestorDirsOf("apps/desktop/src/App.tsx")).toEqual(["apps", "apps/desktop", "apps/desktop/src"]);
  expect(ancestorDirsOf("/src/main.ts")).toEqual(["src"]); // 绝对/前导斜杠不产生空目录
});

it("命令面板：文件搜索走 workspaceSearch，错误/截断如实呈现，面板自身有错误边界", () => {
  expect(palette).toContain("window.agent.workspaceSearch(searchWorkspace, searchQuery)");
  expect(palette).toContain("onOpenFile?: (path: string) => void;");
  expect(palette).toContain("data-file={hit.path}");
  expect(palette).toContain("文件搜索失败：");
  expect(palette).toContain("文件结果已截断");
  expect(palette).toContain('<RenderErrorBoundary variant="inline">');
  expect(palette).toContain("<PaletteContent {...rest} />");
});

it("接线：选中文件 → 开文件窗格 + fileTarget；PaneDock 激活 file 标签；FilePane 展开并预览", () => {
  expect(workbench).toContain("onOpenFile={(path) => {");
  expect(workbench).toContain('openPane("file")');
  expect(workbench).toContain("setFileTarget((prev) => ({ path, seq: (prev?.seq ?? 0) + 1 }))");
  expect(workbench).toContain("fileTarget !== null ? { fileTarget } : {}");
  expect(paneDock).toContain("fileTarget?: { path: string; seq: number };");
  expect(paneDock).toContain('if (props.fileTarget !== undefined) setFocusedPane("file");');
  expect(paneDock).toContain("openTarget: props.fileTarget");
  expect(filePane).toContain("openTarget?: { path: string; seq: number };");
  expect(filePane).toContain("const parents = ancestorDirsOf(target.path);");
  expect(filePane).toContain("openFile(target.path);");
  expect(filePane).toContain("if (dirs[parent] === undefined) loadDir(parent);");
});
