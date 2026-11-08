import { describe, expect, it } from "vitest";
import {
  APP_DESTINATIONS,
  destinationForSection,
  PAGE_CONTEXT_ITEMS,
  pageForDestination,
} from "../src/renderer/navigation";

describe("Agent OS navigation facts", () => {
  it("orders Chat, Plugins, Memory, Automation", () => {
    expect(APP_DESTINATIONS).toEqual(["chat", "plugins", "memory", "automation"]);
  });

  it("maps durable pages and unrelated settings independently", () => {
    expect(pageForDestination("plugins")).toBe("plugins");
    expect(pageForDestination("memory")).toBe("memory");
    expect(pageForDestination("automation")).toBe("automation");
    expect(pageForDestination("chat")).toBeNull();
    expect(destinationForSection("memory")).toBe("memory");
    expect(destinationForSection("skills")).toBeNull();
    expect(destinationForSection("provider")).toBeNull();
  });

  it("gives plugins capability filters only — marketplace views move to the in-page tabs", () => {
    // 2026-11-02：视图（发现/已安装/可更新）从这一栏下架，只由页内标签条承载，
    // 否则「同一件事三处入口」（页内标签条 + 页头下拉 + 左侧上下文栏）。
    expect(PAGE_CONTEXT_ITEMS.plugins).toEqual([
      { id: "all", label: "全部能力" },
      { id: "favorites", label: "精选" },
      { id: "skills", label: "技能" },
      { id: "commands", label: "命令" },
      { id: "agents", label: "智能体" },
      { id: "hooks", label: "钩子" },
      { id: "mcp", label: "MCP" },
      { id: "lsp", label: "LSP" },
    ]);
    // 防回归：视图 id 不许再回到筛选栏。
    for (const id of ["discover", "installed", "updates"]) {
      expect(PAGE_CONTEXT_ITEMS.plugins.some((item) => item.id === id), `筛选栏不该再有视图项 ${id}`).toBe(false);
    }
  });
});
