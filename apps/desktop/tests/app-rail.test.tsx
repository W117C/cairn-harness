import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRail } from "../src/renderer/components/AppRail";
import { keysOf } from "../src/renderer/shortcuts";

// ADR 0019 1:1（官方首屏真机对照 2026-11-19，official-home.png）：窄图标轨下架，
// 全局导航 = 会话列顶部的行族（图标+文字，与官方 New/Search/Routines/Customize 同形制）。
// 官方 4 行 vs 我们 6 行：多出的「技能/记忆」两行是自有能力按官方行形制安置（ADR 0019 §4）。
describe("AppRail（单栏顶部行族）", () => {
  const html = (destination: "chat" | "plugins" | "memory" | "automation") =>
    renderToStaticMarkup(
      <AppRail
        destination={destination}
        onOpen={() => undefined}
        onNewTask={() => undefined}
        onSettings={() => undefined}
        badges={{ plugins: 3 }}
      />,
    );

  it("行族构成：新任务（主行）→ 搜索 → 定时任务 → 技能 → 记忆 → 自定义，恰六行", () => {
    const h = html("chat");
    expect(h).toContain('aria-label="全局功能"');
    expect(h).toContain('data-row="new"');
    expect(h).toContain('data-row="search"');
    expect(h).toContain('data-destination="automation"');
    expect(h).toContain('data-destination="plugins"');
    expect(h).toContain('data-destination="memory"');
    expect(h).toContain('data-row="customize"');
    expect((h.match(/class="app-rail-item"/g) ?? []).length).toBe(6);
  });

  it("行名与官方同形制对位：New=新任务、Search=搜索、Routines=定时任务、Customize=自定义（技能/记忆为自有行）", () => {
    const h = html("chat");
    for (const label of ["新任务", "搜索", "定时任务", "技能", "记忆", "自定义"]) {
      expect(h).toContain(`>${label}</span>`);
    }
  });

  it("New 行是主动作：新任务键位与 SHORTCUTS 表同源（kbd 可见，tooltip 不手抄）", () => {
    const h = html("chat");
    expect(h).toContain(`title="新任务（${keysOf("new-session")}）"`);
    expect(h).toContain(`class="app-rail-keys">${keysOf("new-session")}</kbd>`);
  });

  it("搜索行是侧栏会话搜索的开关（不冒充命令面板），展开态受控", () => {
    const closed = html("chat");
    expect(closed).toContain('data-sidebar-search-toggle="true"');
    expect(closed).toContain('aria-label="搜索会话"');
    expect(closed).toContain('aria-expanded="false"');
    const open = renderToStaticMarkup(
      <AppRail destination="chat" onOpen={() => undefined} onNewTask={() => undefined} onSettings={() => undefined} searchOpen />,
    );
    expect(open).toContain('aria-expanded="true"');
  });

  it("目的地行随 destination 标 current（chat 是 New 行的领地，无 current）", () => {
    for (const destination of ["chat", "plugins", "memory", "automation"] as const) {
      const h = html(destination);
      const current = h.match(/aria-current="page"/g) ?? [];
      if (destination === "chat") expect(current, destination).toHaveLength(0);
      else expect(current, destination).toHaveLength(1);
    }
    expect(html("memory")).toMatch(/data-destination="memory"[^>]*aria-current="page"/);
  });

  it("徽标跟随行（插件行更新数），计数进可读名", () => {
    const h = html("plugins");
    expect(h).toContain('class="app-rail-badge"');
    expect(h).toContain("3");
    expect(h).toContain('aria-label="技能，3 项"');
  });
});
