// P3-3 命令面板 + 快捷键统一判卷：判卷先红——本文件先于实现落盘。
//   ① PaletteContent SSR：四组（操作/会话/项目/设置）在场；键位提示与 SHORTCUTS 同源；
//      无会话无项目时操作组犹在（空数据不摆空组也不空屏）。
//   ② ShortcutsSection（设置页「快捷键」区）：渲染 SHORTCUTS 全表 + 速查入口注。
//   ③ 同源哨兵：Sidebar tooltip 从 SHORTCUTS 取键（keysOf），strings 里三处 tooltip 不再手写键位。
//   ④ App 哨兵：⌘O/⌘K/⌘./⌘, 键位接线 + 面板真开（替换 comingSoon 提示）+ 挂载 + 打开文件夹流程。
//   ⑤ 面板压层（真机 elementFromPoint 抓到的遮挡缺陷的意图钉）：面板必须压在自己的遮罩上——
//      否则鼠标点条目全被吃成 outside-click（键盘路径正常，故此前判卷未暴露）；遮罩独立
//      cp-scrim（cp-overlay 与旧模型选择弹窗撞名，靠它不被拖走 90 档）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Command } from "cmdk";
import { PaletteContent } from "../src/renderer/components/CommandPalette";
import { ShortcutsSection } from "../src/renderer/components/settings-sections";
import { SHORTCUTS } from "../src/renderer/shortcuts";
import type { WorkspaceSession } from "../src/renderer/sessions-view";

const appSrc = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const sidebarSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/Sidebar.tsx", import.meta.url)), "utf8");
const stringsSrc = readFileSync(fileURLToPath(new URL("../src/renderer/strings.ts", import.meta.url)), "utf8");
const paletteSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/CommandPalette.tsx", import.meta.url)), "utf8");

const sessions = [
  { id: "s1", title: "改登录页", mtimeMs: Date.now() - 60_000, lines: 3, workspace: "/tmp/w" },
] as unknown as WorkspaceSession[];
const projects = [{ id: "p1", name: "cairn", path: "/tmp/cairn" }];
const base = {
  sessions,
  projects,
  onOpenSession: () => undefined,
  onSwitchWorkspace: () => undefined,
  onOpenSettings: () => undefined,
  onAction: () => undefined,
};

describe("① PaletteContent SSR（命令面板内容面）", () => {
  it("四组在场：操作 / 会话 / 项目 / 设置；操作条目与键位提示在场", () => {
    const html = renderToStaticMarkup(
      <Command>
        <PaletteContent {...base} />
      </Command>,
    );
    expect(html).toContain("操作");
    // 2026-10-18：⌘F 查找进操作组（键位从 SHORTCUTS 取，不手写）
    expect(html).toContain("在当前会话中查找");
    expect(html).toContain("新任务");
    expect(html).toContain("打开文件夹");
    expect(html).toContain("切换主题");
    expect(html).toContain("切换权限档");
    expect(html).toContain("开合检查器");
    // 键位提示与 SHORTCUTS 同源（新任务 ⌘N / 打开文件夹 ⌘O / 开合检查器 ⌘⌥B）
    expect(html).toContain("⌘N");
    expect(html).toContain("⌘O");
    expect(html).toContain("⌘⌥B");
    // 会话与项目组：标题 / 项目名在场
    expect(html).toContain("改登录页");
    expect(html).toContain("cairn");
    // 设置页目的地链路在（分区入口样例）
    expect(html).toContain("模型与 Provider");
  });

  it("无会话无项目：操作与设置组仍在（空数据不摆空组也不空屏）", () => {
    const html = renderToStaticMarkup(
      <Command>
        <PaletteContent {...base} sessions={[]} projects={[]} />
      </Command>,
    );
    expect(html).toContain("操作");
    expect(html).toContain("新任务");
    expect(html).not.toContain("改登录页");
    expect(html).not.toContain("cairn");
  });
});

describe("② ShortcutsSection（设置页「快捷键」区）", () => {
  it("渲染 SHORTCUTS 全表：label+keys 都在 + 速查入口注（⌘/）", () => {
    const html = renderToStaticMarkup(<ShortcutsSection />);
    for (const s of SHORTCUTS) {
      expect(html).toContain(s.keys);
      expect(html).toContain(s.label);
    }
    expect(html).toContain("⌘/");
  });
});

describe("③ 同源哨兵（tooltip 与表同源，防漂移）", () => {
  it("Sidebar tooltip 键位从 SHORTCUTS 取（withKeys 三处 + keysOf 内取）", () => {
    expect(sidebarSrc).toContain('from "../shortcuts"');
    expect(sidebarSrc).toContain('withKeys(STR.sidebar.newTaskTip, "new-session")');
    expect(sidebarSrc).toContain('withKeys(STR.sidebar.searchTip, "palette")');
    expect(sidebarSrc).toContain('withKeys(STR.footer.settingsTip, "settings")');
    expect(sidebarSrc).toContain("keysOf(id)");
  });

  it("strings.ts 三处 tooltip 不再手写键位（新任务 / 搜索会话与命令 / 设置）", () => {
    expect(stringsSrc).not.toContain("新任务（⌘N）");
    expect(stringsSrc).not.toContain("搜索会话与命令（⌘K）");
    expect(stringsSrc).not.toContain("设置（⌘,）");
  });
});

describe("④ App 哨兵（键位 → 面板）", () => {
  it("⌘O / ⌘K / ⌘. / ⌘, 键位接线在场", () => {
    expect(appSrc).toContain("h.openFolder()");
    expect(appSrc).toContain("h.openPalette()");
    expect(appSrc).toContain("h.openSettings()");
    expect(appSrc).toContain('case "Period"');
    expect(appSrc).toContain('case "Comma"');
  });

  it("面板真开（替换 comingSoon）：setPaletteOpen(true) + 挂载 <CommandPalette>", () => {
    expect(appSrc).toContain("setPaletteOpen(true)");
    expect(appSrc).toContain("<CommandPalette");
  });

  it("面板打开时 App 全局快捷键让路，不穿透改背景状态", () => {
    expect(appSrc).toContain("if (document.querySelector('[data-modal-surface=\"true\"]') !== null || h.paletteOpen) return;");
  });

  it("命令面板向辅助技术声明模态对话框，而不只是视觉遮罩", () => {
    expect(paletteSrc).toContain('dialog.setAttribute("aria-modal", "true")');
    expect(paletteSrc).toContain('dialog.removeAttribute("aria-modal")');
  });

  it("打开文件夹：pickDirectory → handleAddProject（复用拖放登记口）", () => {
    expect(appSrc).toContain("const pickAndAddProject = useCallback");
    expect(appSrc).toContain("handleAddProject(path)");
  });
});

describe("⑤ 面板压层（真机遮挡缺陷的意图钉）", () => {
  const styles = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
  const paletteSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/CommandPalette.tsx", import.meta.url)), "utf8");
  it("命令面板：遮罩 cp-scrim 115、面板 cp-panel 116——面板压在自己的遮罩上（不然鼠标吃不到）", () => {
    expect(paletteSrc).toContain('overlayClassName="cp-scrim"');
    expect(styles).toMatch(/\.cp-scrim\s*\{[^}]*z-index:\s*115/);
    expect(styles).toMatch(/\.cp-panel\s*\{[^}]*z-index:\s*116/);
  });
  it("旧模型选择弹窗的 cp-overlay 保持 90（不被命令面板的压层拖走）", () => {
    expect(styles).toMatch(/\.cp-overlay\s*\{[^}]*z-index:\s*90/);
  });
});

// ⑥ 布局契约（2026-10-17 真机量得的两处缺陷 + 键盘可发现性）
import { readFileSync as readFileSync2 } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";
describe("⑥ 命令面板布局契约（真机量得的缺陷）", () => {
  const css = readFileSync2(fileURLToPath2(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
  const html = renderToStaticMarkup(
    <Command>
      <PaletteContent {...base} />
    </Command>,
  );
  it("搜索行：图标 + 输入框，且输入框吃满宽度（修前实测 186px，占位符被截半句）", () => {
    expect(html).toContain('class="cp-search"');
    expect(html).toContain("cp-search-ico");
    expect(css).toMatch(/\.cp-input\s*{[^}]*width:\s*100%/s);
  });
  it("列表可滚：cmdk 根与列表都吃剩余高度（修前 689px 塞进 480px 面板且被 overflow:hidden 裁掉）", () => {
    expect(css).toMatch(/\.cp-panel > \[cmdk-root\]\s*{[^}]*min-height:\s*0/s);
    expect(css).toMatch(/\.cp-list\s*{[^}]*min-height:\s*0/s);
    expect(css).toMatch(/\.cp-list\s*{[^}]*overflow-y:\s*auto/s);
  });
  it("键盘提示脚注：↑↓ / ⏎ / esc 在场且 aria-hidden（纯提示）", () => {
    expect(html).toContain("cp-foot");
    expect(html).toContain("选择");
    expect(html).toContain("打开");
    expect(html).toContain("关闭");
    expect(html).toContain('class="cp-foot" aria-hidden="true"');
    expect(css).toMatch(/\.cp-foot\s*{[^}]*border-top/s);
  });
});


// 2026-10-17 真机实证：占位符承诺搜「设置」，但设置条目文本是「通用/记忆系统…」，输入「设置」零命中。
// 修法 = 设置条目的 value 带上「设置」前缀（cmdk 按 value 过滤）。
describe("设置条目可被「设置」搜到", () => {
  it("每个设置条目 value 以「设置 」开头", () => {
    const src = readFileSync2(fileURLToPath2(new URL("../src/renderer/components/CommandPalette.tsx", import.meta.url)), "utf8");
    expect(src).toContain('value={`设置 ${s.label}`}');
  });
});
