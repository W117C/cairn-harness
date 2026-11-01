import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PageFrame } from "../src/renderer/components/PageFrame";

describe("PageFrame", () => {
  it("renders one page title, search, and compact filter", () => {
    const html = renderToStaticMarkup(
      <PageFrame
        title="插件"
        search={{ label: "搜索插件", value: "", onChange: () => undefined }}
        filters={[{ id: "all", label: "全部" }]}
        activeFilter="all"
        onFilter={() => undefined}
      >
        <div>content</div>
      </PageFrame>,
    );

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('aria-label="搜索插件"');
    expect(html).toContain('<select');
    expect(html).toContain('<option value="all" selected="">全部</option>');
    expect(html).toContain("content");
  });

  it("can keep filters visible when the page has no context sidebar", () => {
    const html = renderToStaticMarkup(
      <PageFrame
        title="技能中心"
        filters={[{ id: "all", label: "全部" }]}
        activeFilter="all"
        onFilter={() => undefined}
        inlineFilter
      >
        <div>content</div>
      </PageFrame>,
    );

    expect(html).toContain('class="page-frame-filter page-frame-filter-inline"');
  });

  it("places page-owned commands beside the title without inventing a second header", () => {
    const html = renderToStaticMarkup(
      <PageFrame title="插件" actions={<button type="button">导入</button>}>
        <div>content</div>
      </PageFrame>,
    );

    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html).toContain('class="page-frame-actions"');
    expect(html).toContain("<button type=\"button\">导入</button>");
  });
});
