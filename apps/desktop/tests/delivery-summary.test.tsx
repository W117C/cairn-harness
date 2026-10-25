import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChangeSummaryCard } from "../src/renderer/components/ChangeSummaryCard";
import type { TurnDelivery } from "../src/renderer/projections";
import { readAppSurface } from "./helpers/app-surface";

const failed: TurnDelivery = {
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

describe("ChangeSummaryCard 交付摘要", () => {
  it("固定呈现改动、验证、未验证、下一步四项，并保留文件与验证证据（展开态）", () => {
    const html = renderToStaticMarkup(<ChangeSummaryCard delivery={failed} initialOpen />);
    expect(html).toContain("已编辑 2 个文件");
    expect(html).toContain("第 2 轮");
    expect(html).toContain("验证未过");
    expect(html).toContain("改了什么");
    expect(html).toContain("验证了什么");
    expect(html).toContain("哪些未验证");
    expect(html).toContain("下一步");
    expect(html).toContain("2 个文件：src/a.ts、src/new.ts");
    expect(html).toContain("修复失败项后重新运行验证");
    expect(html).toContain("查看验证证据");
    expect(html).toContain("pnpm test");
    expect(html).toContain("2 tests failed");
    expect(html).toContain("快照");
  });
});

describe("交付卡默认收起（2026-10-18 业主截图批）", () => {
  it("默认只留标题行与展开钮；四问清单/动作/文件明细都不渲染", () => {
    const html = renderToStaticMarkup(<ChangeSummaryCard delivery={failed} />);
    expect(html).toContain("已编辑 2 个文件");
    expect(html).toContain("第 2 轮");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("改了什么");
    expect(html).not.toContain("打开预览");
    expect(html).not.toContain('class="delivery-list"');
    expect(html).toContain('data-open="false"');
  });
});

describe("批 3：交付卡纵向清单（去四宫格）+ 空轮弱行撤下（文档阶段 3·对话页①）", () => {
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const appSrc = readAppSurface();

  it("四格网格已废：卡内为纵向清单，样式层无 delivery-grid/cell 残留", () => {
    const html = renderToStaticMarkup(<ChangeSummaryCard delivery={failed} initialOpen />);
    expect(html).toContain('class="delivery-list"');
    expect(html).not.toContain("delivery-grid");
    expect(html).not.toContain("delivery-cell");
    expect(css).toMatch(/\.delivery-list\s*{/);
    expect(css).not.toMatch(/\.delivery-grid\s*{/);
    expect(css).not.toMatch(/\.delivery-cell\s*{/);
  });

  it("空轮弱行已整体撤下（2026-10-24 业主）：代码与样式层零残留，App 仍经 deliveryTrail 出卡", () => {
    expect(appSrc).toContain("deliveryTrail(");
    expect(appSrc).not.toContain("formatEmptyTrailNote");
    expect(appSrc).not.toContain('className="round-note"');
    // 钉弱行特有格式（「第 N 轮 · 无文件改动」）；卡展开态的零文件明细「无文件改动」是另一处合法文案。
    expect(appSrc).not.toContain("· 无文件改动");
    expect(css).not.toMatch(/\.round-note\s*{/);
  });
});
