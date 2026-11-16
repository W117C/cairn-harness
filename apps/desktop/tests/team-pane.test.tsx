// 团队会话窗格判卷（规格 §5 第三刀，第 10 个窗格种类）：
// 打开即有一轮发言秩序（自动，不点按钮）、名单带角色与档位、空态与停机态分得开。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamPane } from "../src/renderer/panes/TeamPane";
import type { TeamRosterPayload, TeamRoundPlanPayload } from "../../../src/main/ipc-protocol";

const roster: TeamRosterPayload = {
  members: [
    { id: "m1", name: "阿岚", role: "主持", tier: "guided", capabilities: [] },
    { id: "m2", name: "小北", role: "实现", tier: "read-only", capabilities: [] },
  ],
  clamped: [],
  rejected: [],
  records: 2,
};

const plan: TeamRoundPlanPayload = {
  batches: [{ order: 1, speakers: ["m1"] }, { order: 2, speakers: ["m2"] }],
  paused: false,
  pausedReason: null,
  silent: [],
  unknown: [],
  roster: [
    { id: "m1", name: "阿岚", tier: "guided" },
    { id: "m2", name: "小北", tier: "read-only" },
  ],
};

describe("团队会话窗格", () => {
  it("名单带名字/角色/档位，且秩序按名字渲染", () => {
    const html = renderToStaticMarkup(<TeamPane initialRoster={roster} initialPlan={plan} />);
    expect(html).toContain('data-team-pane="true"');
    expect(html).toContain("阿岚");
    expect(html).toContain("主持");
    expect(html).toContain("guided");
    expect(html).toContain("1. 阿岚");
    expect(html).toContain("2. 小北");
  });

  it("空转停机单独说一句，不是空名单", () => {
    const html = renderToStaticMarkup(
      <TeamPane
        initialRoster={roster}
        initialPlan={{ ...plan, batches: [], paused: true, pausedReason: "idle" }}
      />,
    );
    expect(html).toContain("整体停机等人");
  });

  it("派活入口在：每个成员一个「派活」按钮，外加任务书输入与「放进他的线程」", () => {
    const html = renderToStaticMarkup(<TeamPane initialRoster={roster} initialPlan={plan} />);
    expect((html.match(/团队 pane|派活/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("任务书写什么");
    expect(html).toContain("放进他的线程");
  });

  it("群会话入口在：名字输入 + 「新建群会话」", () => {
    const html = renderToStaticMarkup(<TeamPane initialRoster={roster} initialPlan={plan} />);
    expect(html).toContain("新建群会话");
    expect(html).toContain("群会话名字");
  });

  it("群轮次入口在：「下一轮」", () => {
    expect(renderToStaticMarkup(<TeamPane initialRoster={roster} initialPlan={plan} />)).toContain("下一轮");
  });

  it("空名单说「空名单」", () => {
    const html = renderToStaticMarkup(
      <TeamPane initialRoster={{ ...roster, members: [], records: 0 }} initialPlan={{ ...plan, batches: [], roster: [] }} />,
    );
    expect(html).toContain("空名单");
  });

  it("群聊共享流：渲染出带轮与说话人的条目（只读投影）", () => {
    const html = renderToStaticMarkup(<TeamPane initialRoster={roster} initialStream={{
      dropped: 2,
      items: [
        { seq: 1, kind: "user", speaker: "user", round: 1, text: "第一轮：一起看下" },
        { seq: 2, kind: "agent", speaker: "member:m1", round: 1, text: "我先来" },
      ],
    }} />);
    expect(html).toContain('data-stream="true"');
    expect(html).toContain("第1轮 member:m1");
    expect(html).toContain("我先来");
  });

  it("记忆面板：三层主题数与合计都在，缺层点名", () => {
    const html = renderToStaticMarkup(<TeamPane initialRoster={roster} initialMemory={{
      total: { topics: 5 },
      missingScopes: ["member"],
      rows: [
        { scope: "project", topics: 2 },
        { scope: "team", topics: 3 },
      ],
    }} />);
    expect(html).toContain('data-memory="true"');
    expect(html).toContain("记忆：5 个主题");
    expect(html).toContain("缺层：member");
  });
});
