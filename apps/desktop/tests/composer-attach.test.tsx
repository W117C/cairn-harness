// 附件菜单判卷（P2-2 重写：v8「为什么还要粘贴路径」→ P2 计划「＋菜单四入口 · 零路径手输」）。
// 判卷四格：① 菜单入口门槛形态（给了才在）；② 四入口文案与顺序；③ main 侧 wired 行是真 dialog
// 多选（不是空壳）；④ renderer 真接线（App 把 window.agent.pickFiles 传下去）。路径手输入口已清退，
// 其源文哨兵在 composer-rework.test.tsx。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../src/renderer/components/Composer";
import { STR } from "../src/renderer/strings";

const base = {
  mode: "default" as const,
  running: false,
  stopped: false,
  activeId: "s1",
  providerInfo: null,
  pickerValue: null,
  usage: { inputTokens: 0, outputTokens: 0, usageCount: 0, cacheReadTokens: 0, lastInputTokens: 0 },
  phaseLabel: "执行工具",
  phase: "tool" as const,
  elapsedSec: 0,
  steps: 0,
  workspaceLabel: null,
  onSend: () => undefined,
  onCancel: () => undefined,
  onModeChange: () => undefined,
  onModelChange: () => undefined,
  onCompact: () => undefined,
};

describe("＋附件菜单四入口（P2-2：零路径手输）", () => {
  it("两枚选择器都给了 ⇒ 四入口齐、顺序= 上传文件… → 添加文件夹… → 粘贴截图 → 引用最近文件", () => {
    const html = renderToStaticMarkup(
      <Composer {...base} onPickFiles={() => Promise.resolve(null)} onPickDirectory={() => Promise.resolve(null)} />,
    );
    expect(html).toContain(`>${STR.composer.attachUpload}<`);
    expect(html).toContain(`>${STR.composer.attachFolder}<`);
    expect(html).toContain(`>${STR.composer.attachPaste}<`);
    expect(html).toContain(`>${STR.composer.attachRecent}<`);
    const at = (s: string): number => html.indexOf(`>${s}<`);
    expect(at(STR.composer.attachUpload)).toBeLessThan(at(STR.composer.attachFolder));
    expect(at(STR.composer.attachFolder)).toBeLessThan(at(STR.composer.attachPaste));
    expect(at(STR.composer.attachPaste)).toBeLessThan(at(STR.composer.attachRecent));
  });

  it("不给选择器 ⇒ 两枚选择器入口不在；粘贴截图与引用最近文件恒在（不依赖系统选择器）", () => {
    const html = renderToStaticMarkup(<Composer {...base} />);
    expect(html).not.toContain(`>${STR.composer.attachUpload}<`);
    expect(html).not.toContain(`>${STR.composer.attachFolder}<`);
    expect(html).toContain(`>${STR.composer.attachPaste}<`);
    expect(html).toContain(`>${STR.composer.attachRecent}<`);
  });

  it("main 侧 wired 行是真 dialog 多选（openFile + multiSelections；空选 ⇒ null 不假报空数组）", () => {
    const indexTs = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");
    expect(indexTs).toMatch(/pickFiles\s*:\s*async\s*\(\)\s*=>\s*\{/);
    expect(indexTs).toContain('properties: ["openFile", "multiSelections"]');
    expect(indexTs).toContain("picked.filePaths.length > 0 ? picked.filePaths : null");
  });

  it("renderer 真接线：App 把 window.agent.pickFiles 传给 Composer（摆入口没人给 = 点不开）", () => {
    const appTsx = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
    expect(appTsx).toContain("onPickFiles={() => window.agent.pickFiles()}");
  });
});
