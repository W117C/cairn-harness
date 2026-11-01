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
    expect(html).toContain("验证失败"); // 第 944 页：与编排面同一套词
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

describe("交付卡收起态层级", () => {
  it("整行可展开，改动统计与轮次退为次级信息，不再堆状态芯片", () => {
    const html = renderToStaticMarkup(<ChangeSummaryCard delivery={failed} />);
    expect(html).toMatch(/<button[^>]*class="changes-head"[^>]*aria-expanded="false"/);
    expect(html).toContain('class="cf-heading"');
    expect(html).toContain('class="cf-subtitle"');
    expect(html).toContain('class="cf-round num">第 2 轮</span>');
    expect(html).not.toContain('class="chip">第 2 轮</span>');
    expect(html).not.toContain('<button type="button" class="changes-toggle');
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.cf-heading\s*{[^}]*flex:\s*1/s);
    expect(css).toMatch(/\.cf-subtitle\s*{[^}]*font-weight:\s*var\(--fw-regular\)/s);
  });
});

describe("交付卡展开态文件审阅", () => {
  it("文件清单有独立分组与计数，路径和快照各自成列，操作区不再贴边", () => {
    const html = renderToStaticMarkup(
      <ChangeSummaryCard
        delivery={failed}
        initialOpen
        actions={{ onOpenPreview: () => {}, onRevert: () => {}, onExport: () => {} }}
      />,
    );
    expect(html).toContain('<section class="changes-files" aria-label="改动文件">');
    expect(html).toContain('class="changes-files-head"');
    expect(html).toContain('class="changes-files-count num">2</span>');
    expect(html).toContain('class="ci-path"');
    expect(html).toContain("已存快照");
    expect(html).toContain('class="mini-btn primary delivery-action"');
    expect(html).toContain('class="mini-btn delivery-action delivery-action-danger"');

    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.ci-path\s*{[^}]*font-family:\s*var\(--mono\)[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.delivery-actions\s*{[^}]*padding:\s*var\(--space-sm\) var\(--space-md\)[^}]*border-top:/s);
    expect(css).toMatch(/\.delivery-action-danger\s*{[^}]*color:\s*hsl\(var\(--color-risk\)\)/s);
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
    expect(css).toMatch(/\.delivery-list\s*{[^}]*grid-template-columns:\s*max-content minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.dg-v\s*{[^}]*font-size:\s*var\(--fs-caption-md\)/s);
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

/** 卡头不重复报数（2026-11-01 第 913 页）：单一档时标题已经说了数字，副行再念一遍是同一句话两遍；
 *  而 change 缺席（投影明确不判定新建/修改）此前只进总数不进分解 ⇒ 全是 unknown 时副行是空的，
 *  标题却断言「已编辑」——投影不猜的东西被界面猜了一遍。 */
describe("卡头：一档不重复、未判定档不失踪", () => {
  const card = (files: TurnDelivery["files"]): string => renderToStaticMarkup(
    <ChangeSummaryCard delivery={{ ...failed, files }} initialOpen={false} />,
  );

  it("全是修改 ⇒ 标题直接说「修改 N 个文件」，不再出现「已编辑」与第二个数", () => {
    const h = card([{ path: "src/a.ts", change: "modified" }]);
    expect(h).toContain("修改 1 个文件");
    expect(h).not.toContain("已编辑");
    expect((h.match(/class="cf-stats/g) ?? []).length, "单一档不该再挂分解块（那会把标题的数字念第二遍）").toBe(0);
    expect(h).toContain("第 2 轮");
  });

  it("含未判定（change 缺席）⇒ 走「变更」，不冒充「已编辑」", () => {
    const h = card([
      { path: "src/a.ts", change: "unknown" as TurnDelivery["files"][number]["change"] },
      { path: "src/b.ts", change: "unknown" as TurnDelivery["files"][number]["change"] },
    ]);
    expect(h).toContain("变更 2 个文件");
    expect(h).not.toContain("已编辑");
  });

  it("混合档才拆分解，且分解里的数相加等于标题的总数", () => {
    const h = card([
      { path: "src/a.ts", change: "modified" },
      { path: "src/new.ts", change: "created" },
      { path: "src/x.ts", change: "unknown" as TurnDelivery["files"][number]["change"] },
    ]);
    expect(h).toContain("已编辑 3 个文件");
    expect(h).toContain("新建 1");
    expect(h).toContain("修改 1");
    expect(h).toContain("变更 1");
    // 反向自证：三档都在，说明"未判定"不再失踪；分隔点恰好两枚。
    expect((h.match(/class="cf-sep"/g) ?? []).length).toBe(2);
  });
});
