// 侧栏成员区判卷（设计规格 §5：「成员区另开文件」，不塞进 928 行的 Sidebar）。
// 判：名单与档位看得见、空态说「空」而不是留白、写入口的指路在（侧栏只读）。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamRosterBlock } from "../src/renderer/components/TeamRosterBlock";
import type { TeamRosterPayload } from "../../../src/main/ipc-protocol";

const roster = (over: Partial<TeamRosterPayload> = {}): TeamRosterPayload => ({
  members: [
    { id: "m1", name: "阿岚", role: "调研", tier: "guided", capabilities: [] },
    { id: "m2", name: "小北", role: "实现", tier: "read-only", capabilities: [] },
  ],
  clamped: [],
  rejected: [],
  records: 4,
  ...over,
});

describe("侧栏成员区", () => {
  it("名单：名字与档位都在，计数字段是真的成员数", () => {
    const html = renderToStaticMarkup(<TeamRosterBlock initialRoster={roster()} />);
    expect(html).toContain("阿岚");
    expect(html).toContain("guided");
    expect(html).toContain("小北");
    expect(html).toContain(">2<");
  });

  it("空名单说「空名单」，并指路到设置 › 团队（侧栏只读）", () => {
    const html = renderToStaticMarkup(<TeamRosterBlock initialRoster={roster({ members: [], records: 0 })} />);
    expect(html).toContain("空名单");
    expect(html).toContain("设置 › 团队");
    // 侧栏不提供写按钮：增删改只走设置页那一条写通道
    expect(html).not.toContain("<button");
  });
});
