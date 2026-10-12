// parseBlocks / renderInline 判卷（spec ③ 的验收面：assistant 正文必须渲染成结构块，不是裸文本）。
// 纯函数判卷（node 环境，同 model-picker / settings-panel 先例）；渲染面（转义、复制钮）
// 走 react-dom/server——见 render-structure.test.tsx 的 Markdown 节。
import { describe, expect, it } from "vitest";
import { parseBlocks, renderInline } from "../src/renderer/markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/renderer/markdown";

describe("parseBlocks：块级解析", () => {
  it("标题分级（#/##/###/####），行尾 # 剥掉", () => {
    const blocks = parseBlocks("# 一级\n## 二级 ###");
    expect(blocks[0]).toEqual({ type: "heading", level: 1, text: "一级" });
    expect(blocks[1]).toEqual({ type: "heading", level: 2, text: "二级" });
  });

  it("围栏代码块带语言；未闭合围栏按开放块渲染（流式不闪烁）", () => {
    const closed = parseBlocks("```ts\nconst a = 1;\n```");
    expect(closed[0]).toEqual({ type: "code", lang: "ts", content: "const a = 1;", open: false });
    const open = parseBlocks("```python\nprint(1)");
    expect(open[0]).toEqual({ type: "code", lang: "python", content: "print(1)", open: true });
  });

  it("无序/有序列表：连续行合并；与代码块互不吞", () => {
    const blocks = parseBlocks("- 甲\n- 乙\n1. 子一\n2. 子二");
    expect(blocks[0]).toEqual({ type: "ul", items: ["甲", "乙"] });
    expect(blocks[1]).toEqual({ type: "ol", items: ["子一", "子二"] });
  });

  it("引用（连续 > 合并一段）与分隔线", () => {
    const blocks = parseBlocks("> 第一行\n> 第二行\n\n---");
    expect(blocks[0]).toEqual({ type: "quote", text: "第一行\n第二行" });
    expect(blocks[1]).toEqual({ type: "hr" });
  });

  it("表格：首行表头 + 分隔行 + 数据行", () => {
    const blocks = parseBlocks("| A | B |\n| --- | --- |\n| 1 | 2 |");
    expect(blocks[0]).toEqual({ type: "table", header: ["A", "B"], rows: [["1", "2"]] });
  });

  it("段落按空行聚合；行内换行保留", () => {
    const blocks = parseBlocks("第一段第一行\n第一段第二行\n\n第二段");
    expect(blocks).toEqual([
      { type: "p", text: "第一段第一行\n第一段第二行" },
      { type: "p", text: "第二段" },
    ]);
  });

  it("普通文本里的 # 和 - 不误判（要有空格才成块）", () => {
    const blocks = parseBlocks("C# 是语言\n-3 是负数");
    expect(blocks[0]!.type).toBe("p");
  });
});

describe("renderInline：行内要素", () => {
  it("粗体/斜体/删除线/行内代码", () => {
    const nodes = renderInline("**粗** *斜* ~~删~~ `码`");
    expect(nodes).toHaveLength(7); // 4 标记 + 3 空白
    expect(renderToStaticMarkup(<>{nodes}</>)).toBe("<strong>粗</strong> <em>斜</em> <del>删</del> <code class=\"md-icode\">码</code>");
  });

  it("链接只放行 http(s)，target=_blank + noreferrer", () => {
    const html = renderToStaticMarkup(<>{renderInline("[文档](https://example.com/a)")}</>);
    expect(html).toBe("<a href=\"https://example.com/a\" target=\"_blank\" rel=\"noreferrer\">文档</a>");
    // 非	http(s) 的"链接"不是链接，是字面文本
    const plain = renderToStaticMarkup(<>{renderInline("[x](javascript:alert(1))")}</>);
    expect(plain).not.toContain("<a");
  });
});

describe("Markdown 渲染面：XSS 纪律（全部文本节点，不注入 HTML）", () => {
  it("尖括号是文本不是标签", () => {
    const html = renderToStaticMarkup(<Markdown text={"<script>alert(1)</script>"} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("代码块带语言标签与复制钮", () => {
    const html = renderToStaticMarkup(<Markdown text={"```css\nbody{}\n```"} />);
    expect(html).toContain('class="lang">css<');
    expect(html).toContain('aria-label="复制代码"');
  });

  it("流式光标（caret）落在最后一个文本块的行内，不是独立一行（业主实测抓到的形态）", () => {
    const html = renderToStaticMarkup(<Markdown text={"第一段\r\n\r\n正在写第二"} caret={true} />);
    // caret 在 <p> 内部、跟在正文后面
    expect(html).toMatch(/<p class="md-p">正在写第二<span class="cursor"/);
    const html2 = renderToStaticMarkup(<Markdown text={"```ts\nconst a=1;"} caret={true} />);
    // 末块是代码块时不放 caret（放进去反而怪）
    expect(html2).not.toContain('class="cursor"');
  });
});
