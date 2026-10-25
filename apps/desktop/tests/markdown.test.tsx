// parseBlocks / renderInline 判卷（spec ③ 的验收面：assistant 正文必须渲染成结构块，不是裸文本）。
// 纯函数判卷（node 环境，同 model-picker / settings-panel 先例）；渲染面（转义、复制钮）
// 走 react-dom/server——见 render-structure.test.tsx 的 Markdown 节。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

  it("段落内单换行渲染为 <br/>（第十二遍：模型按「不要代码围栏」直吐整份 HTML，曾把换行折成空格糊成一大坨）", () => {
    const html = renderToStaticMarkup(<Markdown text={"第一行\n第二行\n\n第三段"} />);
    expect(html).toContain('<p class="md-p">第一行<br/>第二行</p>');
    expect(html).toContain('<p class="md-p">第三段</p>');
    // 换行是结构不是装饰：行数原样，不吞不并
    const wall = renderToStaticMarkup(<Markdown text={"</g>\n<circle r=\"9\"/>\n<g transform=\"x\">"} />);
    expect(wall.match(/<br\/>/g)?.length).toBe(2);
  });

  it("流式光标（caret）落在最后一个文本块的行内，不是独立一行（业主实测抓到的形态）", () => {
    const html = renderToStaticMarkup(<Markdown text={"第一段\r\n\r\n正在写第二"} caret={true} />);
    // caret 在 <p> 内部、跟在正文后面
    expect(html).toMatch(/<p class="md-p">正在写第二<span class="cursor"/);
    const html2 = renderToStaticMarkup(<Markdown text={"```ts\nconst a=1;"} caret={true} />);
    // 2026-10-24 业主：光标要跟字走——末块是代码块时收到末行行尾（不消失、不独立一行）
    expect(html2).toMatch(/<pre><code>const a=1;<span class="cursor"/);
  });
});

// ── 阶段 2（全局 UI 重构 brief §二.3）：有序列表序号修复 + 小节标题 ──
// 根因（业主截图批）：编号项之间夹空行时，每条被拆成独立单元素 <ol> ⇒ 全部显示 1.。
// 修复 = 空行桥接：跳空行后仍是同型列表行 ⇒ 并入同一列表（ol 序号随 DOM 递增自然 1.2.3.）。
describe("parseBlocks：列表跨空行合并（序号修复）", () => {
  it("有序列表夹空行仍是一个 ol（1. 2. 3. 递增的前提）", () => {
    const blocks = parseBlocks("1. 甲\n\n2. 乙\n\n\n3. 丙");
    expect(blocks).toEqual([{ type: "ol", items: ["甲", "乙", "丙"] }]);
  });

  it("无序列表同样跨空行合并；列表后接段落不被吞", () => {
    const blocks = parseBlocks("- 甲\n\n- 乙\n\n收尾段落");
    expect(blocks).toEqual([
      { type: "ul", items: ["甲", "乙"] },
      { type: "p", text: "收尾段落" },
    ]);
  });

  it("异型列表/普通行打断列表（不跨型合并、不吞正文）", () => {
    const blocks = parseBlocks("1. 甲\n\n- 乙");
    expect(blocks).toEqual([
      { type: "ol", items: ["甲"] },
      { type: "ul", items: ["乙"] },
    ]);
  });
});

describe("parseBlocks：整行加粗段落归小节标题（brief §二.3「我的判断 / 局限」）", () => {
  it("单行加粗自成段落 ⇒ 标题块（h4；样式层给 secondary·13·600·上留 20px）", () => {
    const blocks = parseBlocks("**我的判断**\n\n这件事能做。");
    expect(blocks[0]).toEqual({ type: "heading", level: 4, text: "我的判断" });
    expect(blocks[1]).toEqual({ type: "p", text: "这件事能做。" });
  });

  it("加粗后紧跟正文（同段）不误判为标题", () => {
    const blocks = parseBlocks("**我的判断**\n这件事能做。");
    expect(blocks[0]!.type).toBe("p");
  });
});

describe("代码块复制反馈（2026-10-18）", () => {
  it("点击后就地变「已复制」，1.2s 后还原；onCopy 缺席不假装成功", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/markdown.tsx", import.meta.url)), "utf8");
    expect(src).toContain("if (props.onCopy === undefined) return;");
    expect(src).toContain("window.setTimeout(() => setCopied(false), 1200);");
    expect(src).toContain('{copied ? "已复制" : "复制"}');
    // 2026-10-18：onCopy 可回报 Promise<boolean>，失败不亮「已复制」
    expect(src).toContain("if (r instanceof Promise) {");
    expect(src).toContain("if (ok !== false) flash();");
    expect(src).toContain("if (r !== false) flash();");
    expect(src).toContain('aria-label={copied ? "已复制代码" : "复制代码"}');
  });

  it("SSR 初始态仍是「复制」按钮", () => {
    const html = renderToStaticMarkup(<Markdown text={"```ts\nconst a = 1;\n```"} onCopy={() => {}} />);
    expect(html).toContain("复制代码");
    expect(html).toContain(">复制<");
  });
});

describe("外部图片门闩（2026-10-18）", () => {
  it("点击门闩才创建 img（先不发请求）", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/markdown.tsx", import.meta.url)), "utf8");
    expect(src).toContain('useState(() => props.src.startsWith("data:image/"))');
    expect(src).toContain("onClick={() => { setShow(true); }}");
    expect(src).toContain("{show ? (");
  });
});

describe("裸 URL 自动链接（2026-10-18）", () => {
  it("http(s) 裸地址变链接；尾部标点留给正文", () => {
    const nodes = renderInline("见 https://example.com/x。");
    const html = renderToStaticMarkup(<p>{nodes}</p>);
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain("。");
  });

  it("Markdown 链接仍用标签文案；javascript: 不自动链接", () => {
    const link = renderToStaticMarkup(<p>{renderInline("[文档](https://a.com/x)")}</p>);
    expect(link).toContain('href="https://a.com/x"');
    expect(link).toContain(">文档</a>");
    const bad = renderToStaticMarkup(<p>{renderInline("javascript:alert(1)")}</p>);
    expect(bad).not.toContain("<a");
  });
});

describe("任务清单（2026-10-18）", () => {
  it("整段 [ ]/[x] 才算 tasklist；混排保持普通列表", () => {
    expect(parseBlocks("- [ ] 甲\n- [x] 乙\n- [X] 丙")[0]).toEqual({
      type: "tasklist",
      items: [{ done: false, text: "甲" }, { done: true, text: "乙" }, { done: true, text: "丙" }],
    });
    expect(parseBlocks("- [ ] 甲\n- 普通条目")[0]).toMatchObject({ type: "ul", items: ["[ ] 甲", "普通条目"] });
  });

  it("SSR 渲染成 md-tasks / data-done", () => {
    const html = renderToStaticMarkup(<Markdown text={"- [ ] 待办\n- [x] 完成"} />);
    expect(html).toContain("md-tasks");
    expect(html).toContain('data-done="false"');
    expect(html).toContain('data-done="true"');
  });
});

describe("图片块（2026-10-18）", () => {
  it("独行图片成块；https 与 data:image 放行；javascript: 回落普通段落", () => {
    expect(parseBlocks("![示例](https://example.com/a.png)")[0]).toEqual({ type: "image", alt: "示例", src: "https://example.com/a.png" });
    expect(parseBlocks("![内联](data:image/png;base64,AAAA)")[0]).toMatchObject({ type: "image" });
    expect(parseBlocks("![坏](javascript:alert(1))")[0]!.type).toBe("p");
    // http 图不画门闩（CSP 只许 https 图源，点了也加载不出）→ 回落段落，由裸 URL 自动链接兜住
    expect(parseBlocks("![明文](http://example.com/a.png)")[0]).toEqual({ type: "p", text: "[明文](http://example.com/a.png)" });
  });

  it("SSR：data:image 直接 img；https 先给门闩（点击前没有 img）", () => {
    const dataHtml = renderToStaticMarkup(<Markdown text={"![示例](data:image/png;base64,AAAA)"} />);
    expect(dataHtml).toContain("md-figure");
    expect(dataHtml).toContain("<img");
    expect(dataHtml).toContain('loading="lazy"');
    expect(dataHtml.toLowerCase()).toContain('referrerpolicy="no-referrer"');
    const remote = renderToStaticMarkup(<Markdown text={"![示例](https://example.com/a.png)"} />);
    expect(remote).toContain("md-img-gate");
    expect(remote).not.toContain("<img");
    expect(remote).toContain("example.com");
    const plain = renderToStaticMarkup(<Markdown text={"![明文](http://example.com/a.png)"} />);
    expect(plain).not.toContain("md-img-gate");
    expect(plain).toContain('href="http://example.com/a.png"');
    expect(plain).not.toContain("!["); // 不留下图片语法的叹号
  });
});

describe("阶段 2 样式钉（styles.css：行内码 / 加粗 / 列表距 / 小节标题）", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
  it("行内码 = 6% 叠色底 / 圆角 4 / 内距 1px 6px / 0.9em / 无边框", () => {
    expect(css).toMatch(/\.md-icode\s*{[^}]*background:\s*hsl\(var\(--text-000\) \/ 6%\)/s);
    expect(css).toMatch(/\.md-icode\s*{[^}]*padding:\s*1px 6px/s);
    expect(css).toMatch(/\.md-icode\s*{[^}]*font-size:\s*0\.9em/s);
  });
  it("加粗 = primary 色 + --fw-bold（600，不变大）", () => {
    expect(css).toMatch(/\.md-body strong\s*{[^}]*color:\s*hsl\(var\(--text-000\)\)/s);
    expect(css).toMatch(/\.md-body strong\s*{[^}]*font-weight:\s*var\(--fw-bold\)/s);
  });
  it("列表项间距 6px", () => {
    expect(css).toMatch(/\.md-ul li,\s*\.md-ol li\s*{[^}]*margin:\s*6px 0/s);
  });
  it("小节标题（h3–h6）= secondary 色 + 13px + 600 + 上留 20px", () => {
    expect(css).toMatch(/\.md-h3,\s*\.md-h4,\s*\.md-h5,\s*\.md-h6\s*{[^}]*color:\s*hsl\(var\(--text-200\)\)/s);
    expect(css).toMatch(/\.md-h3,\s*\.md-h4,\s*\.md-h5,\s*\.md-h6\s*{[^}]*font-size:\s*var\(--fs-prose-s\)/s);
    expect(css).toMatch(/\.md-h3,\s*\.md-h4,\s*\.md-h5,\s*\.md-h6\s*{[^}]*margin:\s*20px 0/s);
  });
});
