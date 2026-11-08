// 设置页 MCP 行的 active 显示：整台 / 按工具 / 未激活 / 未记录四态必须分得开。
// 缺席（旧快照）显示「未记录」，不读成「没有激活」。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { McpServerRow } from "../src/renderer/components/McpServerRow";

describe("McpServerRow", () => {
  it("整台激活", () => {
    const h = renderToStaticMarkup(
      <McpServerRow
        server="stub"
        state="connected"
        toolCount={3}
        summary={{ active: true, activeMode: "server", activeToolCount: 3 }}
        activeToolNames={["a", "b", "c"]}
        hasData
      />,
    );
    expect(h).toContain("整台已激活");
    expect(h).toContain("active");
    expect(h).toContain("a、b、c");
  });

  it("按工具激活只显示选中的工具", () => {
    const h = renderToStaticMarkup(
      <McpServerRow
        server="big"
        state="connected"
        toolCount={21}
        summary={{ active: true, activeMode: "tools", activeToolCount: 2 }}
        activeToolNames={["t0", "t1"]}
        hasData
      />,
    );
    expect(h).toContain("按工具激活 2 把");
    expect(h).toContain("t0、t1");
    expect(h).not.toContain("整台已激活");
  });

  it("未激活", () => {
    const h = renderToStaticMarkup(
      <McpServerRow
        server="idle"
        state="disconnected"
        toolCount={2}
        summary={{ active: false, activeMode: "none", activeToolCount: 0 }}
        activeToolNames={[]}
        hasData
      />,
    );
    expect(h).toContain("未激活");
    expect(h).toContain("idle");
    expect(h).not.toContain("按工具激活");
  });

  it("旧快照没有 active 数据 ⇒ 未记录（不是未激活）", () => {
    const h = renderToStaticMarkup(
      <McpServerRow
        server="old"
        state="connected"
        toolCount={1}
        activeToolNames={[]}
        hasData={false}
      />,
    );
    expect(h).toContain("未记录");
    expect(h).not.toContain("未激活");
  });
});
