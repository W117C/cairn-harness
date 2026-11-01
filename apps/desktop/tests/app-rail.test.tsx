import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRail } from "../src/renderer/components/AppRail";

describe("AppRail", () => {
  it("is a labelled navigation rail with one current destination", () => {
    const html = renderToStaticMarkup(
      <AppRail destination="memory" onOpen={() => undefined} onSettings={() => undefined} badges={{ memory: 3 }} />,
    );
    expect(html).toContain('aria-label="全局功能"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("记忆");
    expect(html).toContain("3");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
