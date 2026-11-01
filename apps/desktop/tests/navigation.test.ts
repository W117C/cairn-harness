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

  it("gives plugins the marketplace views and capability categories", () => {
    expect(PAGE_CONTEXT_ITEMS.plugins).toEqual([
      { id: "discover", label: "发现" },
      { id: "installed", label: "已安装" },
      { id: "updates", label: "可更新" },
      { id: "favorites", label: "精选" },
      { id: "skills", label: "技能" },
      { id: "commands", label: "命令" },
      { id: "agents", label: "智能体" },
      { id: "hooks", label: "钩子" },
      { id: "mcp", label: "MCP" },
      { id: "lsp", label: "LSP" },
    ]);
  });
});
