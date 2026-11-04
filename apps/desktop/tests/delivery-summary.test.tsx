// 交付卡按 DSH 官方 ChangedFiles 卡的内容与逻辑（2026-11-03 业主「内容和逻辑也要一样」）：
//   · 单文件：标题「已编辑 <文件名>」，不铺列表；块头给 +N/−M / 二进制 / 过大。
//   · 多文件：标题「已编辑 N 个文件」，列表前 4 行，超过才出「全部 N 个文件」。
//   · 每行只放路径 + 增删行数；块头/行在 Sidebar 打开本轮 review（Cairn 的「变更」窗格）。
//   · 验证状态与四问清单不再进卡（DSH 卡没有这些格），保留在「变更」窗格。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChangeSummaryCard } from "../src/renderer/components/ChangeSummaryCard";
import type { TurnDelivery } from "../src/renderer/projections";
import { readAppSurface } from "./helpers/app-surface";

const delivery: TurnDelivery = {
  round: 2,
  files: [
    { path: "src/a.ts", change: "modified", snapshotId: ".agent/snapshots/1--c1/a.ts" },
    { path: "src/new.ts", change: "created" },
  ],
  verification: {
    status: "failed",
    attempts: 1,
    latest: {
      ok: false,
      auto: true,
      attempt: 1,
      maxAttempts: 3,
      results: [{ command: "pnpm test", ok: false, output: "2 tests failed", cause: "code", exitCode: 1 }],
    },
  },
  unverifiedFiles: ["src/a.ts", "src/new.ts"],
  nextAction: "修复失败项后重新运行验证",
};

const many: TurnDelivery = {
  ...delivery,
  files: Array.from({ length: 6 }, (_, i) => ({ path: `src/f${String(i)}.ts`, change: "modified" as const })),
};

describe("DSH 交付卡：单文件", () => {
  it("标题「已编辑 <文件名>」，不铺列表；不出现轮次/验证/四问", () => {
    const html = renderToStaticMarkup(<ChangeSummaryCard delivery={{ ...delivery, files: [delivery.files[0]!] }} />);
    expect(html).toContain("已编辑 a.ts");
    expect(html).not.toContain("已编辑 1 个文件");
    expect(html).not.toContain("changes-list");
    expect(html).not.toContain("第 2 轮");
    expect(html).not.toContain("验证失败");
    expect(html).not.toContain("改了什么");
    expect(html).not.toContain("哪些未验证");
    expect(html).not.toContain("下一步");
  });
});

describe("DSH 交付卡：多文件", () => {
  it("标题「已编辑 N 个文件」，列表只有路径 + 行数格，没有轮次/验证芯片/四问", () => {
    const html = renderToStaticMarkup(<ChangeSummaryCard delivery={delivery} />);
    expect(html).toContain("已编辑 2 个文件");
    expect(html).toContain('class="changes-list"');
    expect(html).toContain('class="change-row"');
    expect(html).toContain("src/a.ts");
    expect(html).toContain("src/new.ts");
    expect(html).toContain('class="change-row-counts"');
    expect(html).not.toContain("第 2 轮");
    expect(html).not.toContain("验证失败");
    expect(html).not.toContain("改了什么");
    expect(html).not.toContain("查看验证证据");
    expect(html).not.toContain("已存快照");
  });

  it("超过 4 个只铺前 4 行，并出「全部 N 个文件」；不一次铺 6 行", () => {
    const html = renderToStaticMarkup(<ChangeSummaryCard delivery={many} />);
    expect(html).toContain("src/f0.ts");
    expect(html).toContain("src/f3.ts");
    expect(html).not.toContain("src/f4.ts");
    expect(html).toContain("全部 6 个文件");
    expect((html.match(/class="change-row"/g) ?? []).length).toBe(4);
  });
});

describe("DSH 交付卡：没有 Cairn 专属动作行", () => {
  it("DSH 卡只有块头 + 文件列表；打开预览/恢复/导出不在这张卡里", () => {
    const html = renderToStaticMarkup(<ChangeSummaryCard delivery={delivery} />);
    expect(html).toContain("changes-card");
    expect(html).not.toContain("打开预览");
    expect(html).not.toContain("恢复上一版");
    expect(html).not.toContain("导出项目");
    expect(html).not.toContain("delivery-actions");
  });
});

describe("DSH 交付卡：空改动不出卡", () => {
  it("files.length === 0 直接不渲染（不是一张只有「本轮交付」的空卡）", () => {
    const html = renderToStaticMarkup(<ChangeSummaryCard delivery={{ ...delivery, files: [] }} />);
    expect(html).toBe("");
  });
});

describe("DSH 交付卡：壳与逻辑钉", () => {
  it("60px 头部 + 40px 文件磁贴 + 13px 标题 + 悬停预览提示", () => {
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    const head = css.match(/\.changes-head\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(head).toContain("min-height: 60px");
    expect(head).toContain("padding: 8px 10px");
    const tile = css.match(/\.cf-ico\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(tile).toContain("width: 40px");
    expect(tile).toContain("height: 40px");
    expect(tile).toContain("place-items: center");
    expect(css).toMatch(/\.cf-t\s*\{[^}]*font-size:\s*13px/s);
    expect(css).toMatch(/\.change-row\s*\{[^}]*min-height:\s*24px/s);
    expect(css).toContain(".cf-preview-hint");
  });

  it("悬停 500ms 出 diff 预览（比卡窄 48px、最高 420px、无 hunk 头），Escape 关闭", () => {
    const src = readFileSync(new URL("../src/renderer/components/ChangeSummaryCard.tsx", import.meta.url), "utf8");
    expect(src).toContain("window.setTimeout(() => { setPreview(path); }, 500)");
    expect(src).toContain('className="change-preview"');
    expect(src).toContain('role="dialog"');
    expect(src).toContain('if (e.key === "Escape")');
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    const preview = css.match(/\.change-preview\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(preview).toContain("left: 24px");
    expect(preview).toContain("right: 24px");
    expect(preview).toContain("max-height: 420px");
  });

  it("行/块头把目标文件送进变更窗格（DSH 行选中具体文件）", () => {
    const pane = readFileSync(new URL("../src/renderer/components/ChangesPane.tsx", import.meta.url), "utf8");
    const app = readAppSurface();
    expect(pane).toContain("focus?: ChangesFocus");
    expect(pane).toContain("setOpenRound(f.round)");
    expect(pane).toContain("toggle(key, f.path, f.snapshotId)");
    expect(app).toContain("setChangesFocus");
    expect(app).toContain("changesFocusSeq.current += 1");
  });

  it("内容面不再引用验证词表/四问结构；行数由 useChangeStats 逐文件读 changeDiff", () => {
    const src = readFileSync(new URL("../src/renderer/components/ChangeSummaryCard.tsx", import.meta.url), "utf8");
    expect(src).toContain("useChangeStats(d.files)");
    expect(src).not.toContain("verificationLabel");
    expect(src).not.toContain("delivery-list");
    expect(src).not.toContain("STATUS_CHIP");
    expect(src).not.toContain("unverifiedFiles");
    expect(src).not.toContain("nextAction");
    const app = readAppSurface();
    expect(app).toContain("onOpenChanges");
  });
});
