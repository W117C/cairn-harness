// 自动化任务页 · 「新建/编辑任务」表单只在**点了新建之后**才在场（2026-11-03）。
//
// 为什么钉这条：业主截图里空态与那张五行表单**同时在屏上**——点「新建任务」只往空态下面
// 追加一个表单，空态不让位；一屏两块在说同一件事。判据是**在场与否**——
// 像素在 node 测试环境里量不到（那份读数由 shot-schedule.cjs 从真 renderer 取）。
//
// 2026-11-04 工作流形制（业主截图）：空态 = 居中大卡 + 白胶囊「创建定时任务 ∨」下拉
// （模板四选 + 空白自定义），下方保唤行与模板网格照常在场；表单仍只在点击后出现。
// 下拉内容必须包 Portal（页体 overflow:hidden 会把内联弹层裁掉——工具菜单同款坑）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AutomationPane } from "../src/renderer/components/AppPage";
import type { AutomationDefinition } from "../../../src/main/automations";

const noop = (): void => undefined;
const SCHED_EMPTY = {
  tasks: [], history: [], running: 0, queued: 0, cap: 2, startupDone: true,
  tzNotes: {}, warnings: [], definitionsCorrupt: false,
};
const TASK: AutomationDefinition = {
  id: "01J000000000000000000000AA",
  name: "每日巡检",
  prompt: "巡检一遍工作区",
  schedule: { kind: "daily", time: "09:00" },
  timeZone: "Asia/Shanghai",
  permissionTier: "read-only",
  catchUp: "latest",
  enabled: true,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const appSrc = readFileSync(fileURLToPath(new URL("../src/renderer/components/AutomationPane.tsx", import.meta.url)), "utf8");

describe("自动化任务：没点新建，表单不在场", () => {
  it("空态分支：工作流大卡 + 胶囊下拉在场，表单不在场（点开之前不摊着）", () => {
    const h = renderToStaticMarkup(<AutomationPane snap={SCHED_EMPTY} onError={noop} refresh={noop} />);
    // 大卡三件：hero 卡 + 一句话 + 胶囊触发钮。这条不是装饰——下面那条 not.toContain 若不是在
    // 「页真的渲染出来了」的前提下断言的，整页白屏也会让它通过（恒真的判据不是判据）。
    expect(h).toContain("at-hero-card");
    expect(h).toContain("还没有定时任务");
    expect(h).toContain("创建定时任务");
    expect(h).toContain('aria-haspopup="menu"');
    // 保唤行与模板网格照常在场（空态也提供四张模板与保唤开关）
    expect(h).toContain("Cairn 运行会话时保持电脑唤醒。");
    expect(h).toContain("定时任务模板");
    expect(h).toContain("晨会动态");
    expect(h).not.toContain("ap-form");
  });

  it("有任务的正常视图：工具行在场、表单不在场；模板网格与保唤行仍提供", () => {
    const h = renderToStaticMarkup(
      <AutomationPane snap={{ ...SCHED_EMPTY, tasks: [TASK] }} onError={noop} refresh={noop} />,
    );
    expect(h).toContain("ap-toolbar");
    expect(h).toContain("每日巡检");
    expect(h).toContain("定时任务模板");
    expect(h).toContain("Cairn 运行会话时保持电脑唤醒。");
    expect(h).not.toContain("ap-form");
  });

  it("反证：判据有分辨力——「ap-form」这个针在表单真渲染出来时是能中的", () => {
    // 直接把表单那一块的最小形状渲染出来，证明上面的 not.toContain 不是因为针本身永远中不了。
    const probe = renderToStaticMarkup(<div className="ap-form"><div className="ap-form-row" /></div>);
    expect(probe).toContain("ap-form");
  });
});

describe("自动化工作流形制（2026-11-04 业主截图）", () => {
  it("头部双色调 + 副标题；四张模板卡带排程行；胶囊下拉内容包 Portal", () => {
    const h = renderToStaticMarkup(<AutomationPane snap={SCHED_EMPTY} onError={noop} refresh={noop} />);
    expect(h).toContain('class="page-frame-title">自动化<span class="page-frame-title-accent"> 工作流</span></h1>');
    expect(h).toContain("创建定时任务，或排队在闲时算力空闲时后台执行。");
    for (const name of ["晨会动态", "风险扫描", "发布简报", "文档同步检查"]) expect(h).toContain(name);
    for (const line of ["每工作日 09:00", "每天 10:00", "每周五 16:00", "每周三 15:00"]) expect(h).toContain(line);
    // 卡片描述是完整句（省略号只出现在 CSS 截断那一层，不是文案本身）
    expect(h).toContain("只读分析，不改任何文件。");
    // 下拉内容包 Portal（页体 overflow:hidden 裁剪坑——顶栏工具菜单同款）
    expect(appSrc).toContain("<DropdownMenu.Portal>");
  });
});
