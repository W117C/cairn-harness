import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readAppSurface } from "./helpers/app-surface";
import { STR } from "../src/renderer/strings";
import { IntegrationToolbar } from "../src/renderer/components/settings/integration-ui";

// 第 1169 页：集成清单页头只留标题与动作；页级说明句与空态 desc 不再同屏叠两层。
describe("让布局说话：集成清单不叠二级说明", () => {
  it("IntegrationToolbar 只渲染标题与动作，不再渲染 description 段", () => {
    const h = renderToStaticMarkup(
      <IntegrationToolbar title={STR.hooks.hookList} headingRef={createRef()}>
        <button type="button">{STR.hooks.addHook}</button>
      </IntegrationToolbar>,
    );
    expect(h).toContain("<h2");
    expect(h).toContain(STR.hooks.hookList);
    expect(h).toContain(STR.hooks.addHook);
    expect(h).not.toContain("<p");
    expect(h).not.toContain("在会话、工具调用和其他生命周期事件中执行自动化处理。");
  });

  it("空态仍给下一步，但不复述清单用途（Hooks / MCP 两句都不在应用面）", () => {
    const surface = readAppSurface();
    expect(surface).toContain("title={STR.hooks.emptyTitle}");
    expect(surface).toContain("desc={STR.hooks.emptyDesc}");
    expect(surface).toContain("title={STR.mcp.emptyTitle}");
    expect(surface).toContain("desc={STR.mcp.emptyDesc}");
    expect(surface).not.toContain("在会话、工具调用和其他生命周期事件中执行自动化处理。");
    expect(surface).not.toContain("连接本地程序或远程服务，为 Cairn 添加 MCP 工具。");
  });
});
