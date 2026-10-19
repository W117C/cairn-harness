// 侧栏会话行右键菜单判卷（2026-10-18 补）。
//
// 缺口：会话行的 hover「…」菜单有两套动作（置顶/重命名/分叉/归档/删除），但**右键行本身**没有
// 任何反应。macOS 上右键列表行是肌肉记忆——在会话行上右键什么也不发生，会被读成「应用坏了」。
// 项目行本来就有右键（ProjectContextMenu），会话行没有，同一屏两种待遇。
//
// 修法：复用同一个 Radix 菜单（受控 open），不另写一套自绘菜单——否则两份菜单行为会分叉。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sidebar = readFileSync(fileURLToPath(new URL("../src/renderer/components/Sidebar.tsx", import.meta.url)), "utf8");

describe("会话行右键菜单", () => {
  it("会话行挂了 onContextMenu", () => {
    const rowAt = sidebar.indexOf('data-session-id={s.id}');
    expect(rowAt).toBeGreaterThan(-1);
    const row = sidebar.slice(rowAt - 400, rowAt + 900);
    expect(row).toContain("onContextMenu={(e) => {");
  });

  it("右键不得顺带触发行的 onClick（否则开了菜单还换了会话）", () => {
    const at = sidebar.indexOf("onContextMenu={(e) => {");
    const seg = sidebar.slice(at, at + 400);
    expect(seg).toContain("e.preventDefault()");
    expect(seg).toContain("e.stopPropagation()");
  });

  it("复用同一个 Radix 菜单（受控 open），不另写一套自绘", () => {
    expect(sidebar).toContain("open={ctxOpen} onOpenChange={setCtxOpen}");
    expect(sidebar).toContain("const [ctxOpen, setCtxOpen] = useState(false)");
    // 反向：不该出现第二套会话菜单组件
    expect(sidebar).not.toContain("SessionContextMenu");
  });

  it("没有行操作可做时不接管右键（让默认菜单出来）", () => {
    const at = sidebar.indexOf("onContextMenu={(e) => {");
    const seg = sidebar.slice(at, at + 200);
    expect(seg).toContain("if (props.renaming || a === null) return;");
  });

  it("项目行的右键菜单仍在（不因本次改动倒退）", () => {
    expect(sidebar).toContain("function ProjectContextMenu(props: {");
    expect(sidebar).toContain("setCtxMenu({ x: e.clientX, y: e.clientY, project })");
  });
});
