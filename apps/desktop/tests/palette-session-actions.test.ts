// 命令面板缺口判卷（2026-10-18 补）。
//
// 缺口一：面板列得出会话，却不给会话动作。改名/归档/删除三个 handler 在 App 里都有
//         （renameSessionById / requestArchiveSession / requestDeleteSession），却只挂在侧栏
//         行内 ⋯ 菜单上——用户搜到某个会话后想改名，得先关掉面板、再去侧栏找那一行。
//         尤其「重命名」有 F2 快捷键、上了速查表，面板里反而没有入口。
// 缺口二：「开合检查器」在面板里，「开合侧栏」不在——同一个 ⌘B/⌘⌥B 家族只进来一半。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";

const palette = readFileSync(fileURLToPath(new URL("../src/renderer/components/CommandPalette.tsx", import.meta.url)), "utf8");
const appSrc = readAppSurface();

describe("命令面板：单会话动作", () => {
  it("面板提供重命名/归档/删除三个会话动作", () => {
    expect(palette).toContain('"rename" | "archive" | "delete"');
    expect(palette).toContain("重命名当前会话");
    expect(palette).toContain("归档当前会话");
    expect(palette).toContain("删除当前会话");
  });

  it("只在有当前会话时给这三条（主页不摆做不了的动作）", () => {
    expect(palette).toContain("props.activeSessionId !== undefined && props.activeSessionId !== null");
  });

  it("App 把行菜单的同一批 handler 接上去（不另起一套语义）", () => {
    expect(appSrc).toContain("onSessionAction={(action, id) => {");
    expect(appSrc).toContain("requestArchiveSession(target, target.archived !== true)");
    expect(appSrc).toContain("requestDeleteSession(target)");
    expect(appSrc).toContain("activeSessionId={activeId}");
  });

  it("会话不存在时 fail-visible（不静默 no-op）", () => {
    expect(appSrc).toContain('toast.error("会话已不存在")');
  });
});

describe("命令面板：开合侧栏", () => {
  it("toggle-sidebar 进了操作表", () => {
    expect(palette).toContain('"toggle-sidebar"');
    expect(palette).toContain('{ id: "toggle-sidebar", label: "开合侧栏"');
  });

  it("App 分发到真的 toggleSidebar（不是空 case）", () => {
    const at = appSrc.indexOf('case "toggle-sidebar":');
    expect(at).toBeGreaterThan(-1);
    const seg = appSrc.slice(at, appSrc.indexOf("break;", at));
    expect(seg).toContain("toggleSidebar()");
  });
});
