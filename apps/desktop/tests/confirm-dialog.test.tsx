// 统一确认卡（2026-10-17）：把四处 window.confirm 换成产品自绘卡。
// 判两点：① SSR 形态（标题/后果说明/两枚按钮/danger 样式）；② 源码里不再有原生 confirm 调用。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmDialog } from "../src/renderer/components/ConfirmDialog";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("ConfirmDialog（产品自绘二次确认）", () => {
  it("SSR：标题 + 后果说明 + 取消/确认两枚按钮；破坏性动作走 danger 实底", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog title="删除「测试」？" note="此操作无法撤销。" confirmLabel="删除" danger onConfirm={() => undefined} onClose={() => undefined} />,
    );
    expect(html).toContain("confirm-scrim");
    expect(html).toContain("删除「测试」？");
    expect(html).toContain("此操作无法撤销。");
    expect(html).toContain(">取消<");
    expect(html).toContain(">删除<");
    expect(html).toContain("mini-btn danger");
    expect(html).not.toContain("mini-btn primary");
  });

  it("非破坏性动作走 primary；可自定义取消文案", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog title="继续？" confirmLabel="继续" cancelLabel="算了" onConfirm={() => undefined} onClose={() => undefined} />,
    );
    expect(html).toContain("mini-btn primary");
    expect(html).toContain(">算了<");
    expect(html).not.toContain("cc-note");
  });

  it("App / AppPage 不再调用原生 window.confirm（弹窗语言与界面统一）", () => {
    for (const rel of ["../src/renderer/App.tsx", "../src/renderer/components/AppPage.tsx"]) {
      expect(read(rel), rel).not.toMatch(/window\.confirm\(/);
    }
  });
});
