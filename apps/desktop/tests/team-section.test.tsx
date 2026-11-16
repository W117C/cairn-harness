// 团队成员面板判卷（ADR 0015 §四 第一件最小件的界面）：
// 名单、档位、移除、裁剪与拒绝都要**看得见**，不许糊成一句「保存失败」。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamSection } from "../src/renderer/components/settings/TeamSection";
import type { TeamRosterPayload } from "../../../src/main/ipc-protocol";

const roster = (over: Partial<TeamRosterPayload> = {}): TeamRosterPayload => ({
  members: [
    { id: "m1", name: "阿岚", role: "调研", tier: "guided", capabilities: ["read"] },
    { id: "m2", name: "小北", role: "实现", tier: "read-only", capabilities: [] },
  ],
  clamped: [],
  rejected: [],
  records: 3,
  ...over,
});

describe("团队成员面板", () => {
  it("名单：名字、角色、id、档位选择器、移除按钮都在", () => {
    const html = renderToStaticMarkup(<TeamSection initialRoster={roster()} />);
    expect(html).toContain("阿岚");
    expect(html).toContain("小北");
    expect(html).toContain("调研");
    expect(html).toContain("m1");
    // 每个成员两个选择器（权限档 + 记忆作用域）+ 新增行一个 + 发言秩序一个 + 密钥授权成员一个
    expect((html.match(/<select/g) ?? []).length).toBe(7);
    expect((html.match(/移除/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("空名单给出「为什么是空的」而不是一片留白", () => {
    const html = renderToStaticMarkup(<TeamSection initialRoster={roster({ members: [], records: 0 })} />);
    expect(html).toContain("空名单");
    expect(html).toContain("还没有成员");
  });

  it("被裁剪与被拒的都在页面上点名（不静默）", () => {
    const html = renderToStaticMarkup(
      <TeamSection
        initialRoster={roster({
          clamped: [{ id: "m1", requested: "full-access", applied: "guided" }],
          rejected: [{ at: 2, id: "m9", error: "未知字段 \"x\"" }],
        })}
      />,
    );
    expect(html).toContain("full-access→guided");
    expect(html).toContain("未知字段");
  });

  it("发言权：排出来的批序按「1. 名字」渲染（名字从 roster 翻，不显示裸 id）", () => {
    const html = renderToStaticMarkup(
      <TeamSection
        initialRoster={roster()}
        initialPlan={{
          batches: [{ order: 1, speakers: ["m1"] }, { order: 2, speakers: ["m2"] }],
          paused: false,
          pausedReason: null,
          silent: [],
          unknown: [],
          roster: [
            { id: "m1", name: "阿岚", tier: "guided" },
            { id: "m2", name: "小北", tier: "read-only" },
          ],
        }}
      />,
    );
    expect(html).toContain("1. 阿岚");
    expect(html).toContain("2. 小北");
    // 裸 id 不该出现在秩序那一行里（id 只在成员行的副标题）
    expect(html).not.toContain("1. m1");
  });

  it("空转停机时显示「整体停机等人」，不是一张空名单", () => {
    const html = renderToStaticMarkup(
      <TeamSection
        initialRoster={roster()}
        initialPlan={{ batches: [], paused: true, pausedReason: "idle", silent: [], unknown: [], roster: [] }}
      />,
    );
    expect(html).toContain("整体停机等人");
  });

  it("段的序数如实显示（写入点回包为 3 就画 3）", () => {
    const html = renderToStaticMarkup(<TeamSection initialRoster={roster()} initialSegment={3} />);
    expect(html).toContain("当前会话的段");
    expect(/>3</.test(html)).toBe(true);
  });

  it("三维读数：权限（团队档 + 裁剪）、记忆作用域分布、按成员用量都画出来", () => {
    const html = renderToStaticMarkup(
      <TeamSection
        initialRoster={roster({
          insights: {
            permissions: {
              teamTier: "guided",
              clamped: [{ id: "m1", requested: "full-access", applied: "guided" }],
              rows: [{ id: "m1", name: "阿岚", requested: "full-access", applied: "guided", clamped: true }],
            },
            memory: { scopes: [{ scope: "team", members: ["m1"] }, { scope: "member", members: [] }, { scope: "project", members: [] }] },
            usage: { byOwner: [{ owner: "main", inputTokens: 100, outputTokens: 10, events: 1 }], totalEvents: 1 },
          },
        })}
      />,
    );
    /* 2026-11-16（R3）：这三处原先钉裸枚举值（guided / full-access / team）。
       界面不该把内部枚举当文案——同一件事在权限页写的是「智能审批 / 完全允许」，
       记忆作用域写的是「团队 / 成员 / 项目」。断言改为钉同一份读数的人话形：
       读数仍在、关系仍看得见（裁剪从哪档降到哪档），只是不再拿枚举当标签。 */
    expect(html).toContain("团队档 智能审批");
    expect(html).toContain("完全允许→智能审批");
    expect(html).toContain("团队 1");
    expect(html).toContain("main 100/10");
  });

  it("没有任何用量读数时说实话，不画 0/0", () => {
    const html = renderToStaticMarkup(
      <TeamSection
        initialRoster={roster({
          insights: {
            permissions: { teamTier: "guided", clamped: [], rows: [] },
            memory: { scopes: [{ scope: "team", members: [] }, { scope: "member", members: [] }, { scope: "project", members: [] }] },
            usage: { byOwner: [], totalEvents: 0 },
          },
        })}
      />,
    );
    expect(html).toContain("当前会话还没有用量读数");
  });

  it("密钥授权入口在：成员选择 + 密钥名 + 允许/拒绝", () => {
    const html = renderToStaticMarkup(<TeamSection initialRoster={roster()} />);
    expect(html).toContain("成员密钥授权");
    expect(html).toContain("密钥名");
    expect(html).toContain("允许");
    expect(html).toContain("拒绝");
    expect(html).toContain("发起申请");
  });

  it("补丁条数如实显示（历史只增不减）", () => {
    expect(renderToStaticMarkup(<TeamSection initialRoster={roster({ records: 7 })} />)).toContain(">7<");
  });
});
