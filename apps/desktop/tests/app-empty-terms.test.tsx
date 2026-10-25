// 批 6（总纲阶段 3-3）：四页空状态（数据为 0 时只显示 EmptyState、不摆统计卡）+
// 术语清理（journal 投影 / serveScheduler / expandSkillInvocation 出正文，收容进「关于与更新」诊断区）。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { AutomationPane, MemoryPane, PluginsPane, SkillsPane } from "../src/renderer/components/AppPage";
import { DIAGNOSTICS_TEXT } from "../src/renderer/components/settings-sections";

const noop = (): void => undefined;
const PLUGINS_EMPTY = { plugins: [], looseSkills: [], mcpServers: [], toolScopes: [], errors: [], warnings: [] };
const SCHED_EMPTY = { tasks: [], history: [], running: 0, queued: 0, cap: 2, startupDone: true, tzNotes: {} };
const MEM_EMPTY = {
  project: { path: "/w/.agent/memory", index: null, topics: [], pendingExternalRefs: [] },
  global: { path: "/u/memory", index: null, topics: [], pendingExternalRefs: [] },
};

describe("批 6：四页空状态（数据为 0 只显示 EmptyState，不摆统计卡）", () => {
  it("记忆：「还没有记忆。Cairn 会在对话中记下项目约定和你的偏好。」+ 统计行不在场", () => {
    const h = renderToStaticMarkup(<MemoryPane snap={MEM_EMPTY} onError={noop} refresh={noop} />);
    expect(h).toContain("ss-empty");
    expect(h).toContain("还没有记忆");
    expect(h).toContain("Cairn 会在对话中记下项目约定和你的偏好");
    expect(h).not.toContain("ap-stats");
  });

  it("技能：「还没有技能。在输入框输入技能名即可调用。」+ 统计行不在场", () => {
    const h = renderToStaticMarkup(<SkillsPane snap={PLUGINS_EMPTY} onError={noop} refresh={noop} />);
    expect(h).toContain("ss-empty");
    expect(h).toContain("还没有技能");
    expect(h).toContain("在输入框输入技能名即可调用");
    expect(h).not.toContain("ap-stats");
  });

  it("自动化：「还没有定时任务」+ 主按钮「新建任务」；统计行/工具栏不在场", () => {
    const h = renderToStaticMarkup(<AutomationPane snap={SCHED_EMPTY} onError={noop} refresh={noop} />);
    expect(h).toContain("ss-empty");
    expect(h).toContain("还没有定时任务");
    expect(h).toContain("新建任务");
    expect(h).not.toContain("ap-stats");
    expect(h).not.toContain("ap-toolbar");
  });

  it("插件：「还没有插件」+ 路径说法（.agent/plugins）；统计行不在场", () => {
    const h = renderToStaticMarkup(<PluginsPane snap={PLUGINS_EMPTY} onError={noop} refresh={noop} />);
    expect(h).toContain("ss-empty");
    expect(h).toContain("还没有插件");
    expect(h).toContain(".agent/plugins");
    expect(h).not.toContain("ap-stats");
  });

  it("有数据时正常视图照旧（空状态不越权吞正常视图）；技能中心为页头+卡片网格（2026-10-24 参照 Codex 自定义页，统计条下架）", () => {
    const h = renderToStaticMarkup(
      <SkillsPane
        snap={{ ...PLUGINS_EMPTY, looseSkills: [{ name: "n", invoke: "demo:x", description: "d", trust: "trusted" }] }}
        onError={noop}
        refresh={noop}
      />,
    );
    expect(h).toContain("ap-head");
    expect(h).toContain("ap-grid");
    expect(h).not.toContain("ap-stats");
    expect(h).not.toContain("还没有技能");
  });
});

describe("批 6：术语清理（正文说人话，工程词进诊断区）", () => {
  const src = readFileSync(new URL("../src/renderer/components/AppPage.tsx", import.meta.url), "utf8");

  it("正文不出现 journal 投影 / serveScheduler / expandSkillInvocation", () => {
    expect(src).not.toContain("journal 投影");
    expect(src).not.toContain("serveScheduler");
    expect(src).not.toContain("expandSkillInvocation");
  });

  it("自动化页脚注改说人话（补跑/并发可读文案在场）", () => {
    expect(src).toContain("自动补跑");
    expect(src).toContain("最多运行");
  });

  it("诊断区（关于与更新）保留工程词对照（术语收容所）", () => {
    expect(DIAGNOSTICS_TEXT).toContain("serveScheduler");
    expect(DIAGNOSTICS_TEXT).toContain("journal 投影");
    expect(DIAGNOSTICS_TEXT).toContain("expandSkillInvocation");
  });
});
