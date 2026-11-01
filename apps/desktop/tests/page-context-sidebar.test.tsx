import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PageContextSidebar } from "../src/renderer/components/PageContextSidebar";

describe("PageContextSidebar", () => {
  it("marks only the active context filter", () => {
    const html = renderToStaticMarkup(
      <PageContextSidebar
        destination="memory"
        items={[{ id: "all", label: "全部" }, { id: "project", label: "项目层" }]}
        activeFilter="project"
        onFilter={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="记忆上下文"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain("项目层");
  });
});
