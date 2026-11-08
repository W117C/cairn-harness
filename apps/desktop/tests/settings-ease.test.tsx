import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomProviderForm } from "../src/renderer/components/CustomProviderForm";

describe("model setup uses ordinary form fields", () => {
  it("asks for an address and secret without asking users to edit files or name environment variables", () => {
    const html = renderToStaticMarkup(<CustomProviderForm />);
    expect(html).toContain('aria-label="自定义接口地址"');
    expect(html).toContain('aria-label="自定义接口 API key"');
    expect(html).not.toContain('aria-label="自定义接口 key 环境变量名"');
    expect(html).not.toContain(".agent/providers.json");
    expect(html).toContain("获取模型");
  });
});
