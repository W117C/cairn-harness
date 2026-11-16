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
    // 每个成员一个档位选择器 + 一个移除按钮（外加新增行的那个选择器）
    expect((html.match(/<select/g) ?? []).length).toBe(3);
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

  it("补丁条数如实显示（历史只增不减）", () => {
    expect(renderToStaticMarkup(<TeamSection initialRoster={roster({ records: 7 })} />)).toContain(">7<");
  });
});
