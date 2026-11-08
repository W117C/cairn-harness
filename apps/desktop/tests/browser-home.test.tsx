import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BrowserHome } from "../src/renderer/components/BrowserHome";

describe("new browser tab home", () => {
  it("offers address focus and only the existing workspace tools", () => {
    const html = renderToStaticMarkup(<BrowserHome onFocusAddress={() => {}} onOpenPane={() => {}} />);
    expect(html).toContain("输入网址");
    expect(html).toContain("文件");
    expect(html).toContain("终端");
    expect(html).not.toMatch(/最近访问|推荐网站|安装扩展/);
  });
  it("standalone popouts omit tool actions when no host can open them", () => {
    const html = renderToStaticMarkup(<BrowserHome onFocusAddress={() => {}} />);
    expect(html).toContain("输入网址");
    expect(html).not.toContain(">文件<");
    expect(html).not.toContain(">终端<");
  });
});
