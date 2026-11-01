import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Stream, ThinkingLive } from "../src/renderer/components/Stream";
import type { StreamRow } from "../src/renderer/projections";

const tool = (over: Partial<Extract<StreamRow, { kind: "tool" }>> = {}): StreamRow => ({
  kind: "tool", seq: 0, tool: "read_file", summary: "src/example.ts", ...over,
});

describe("消息过程摘要的真实状态", () => {
  it("缺少结果状态的工具不能显示完成，收起时仍说明状态未知", () => {
    const html = renderToStaticMarkup(<Stream rows={[tool()]} view="normal" streaming={false} />);
    expect(html).toContain("状态未知");
    expect(html).not.toContain('aria-label="完成"');
  });

  it("运行中步骤和失败原因在摘要中可见，完整列表保持收起", () => {
    const html = renderToStaticMarkup(<Stream rows={[
      tool({ ok: false, output: "Permission denied: src/example.ts" }),
      tool({ seq: 1, tool: "run_shell", summary: "pnpm test", pending: true }),
    ]} view="normal" />);
    expect(html).toContain("执行中 · 运行 pnpm test");
    expect(html).toContain("1 次失败");
    expect(html).toContain("Permission denied: src/example.ts");
    expect(html).toMatch(/class="tool-group-body" hidden=""/);
  });

  it("历史思考只显示记录，不凭挂载时间生成 0s 耗时或完成状态", () => {
    const html = renderToStaticMarkup(<ThinkingLive seq={1} thinking="先检查接口。" running={false} view="normal" />);
    expect(html).toContain("思考记录");
    expect(html).not.toContain("0s");
    expect(html).not.toContain('aria-label="思考完成"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("详情提供原始输入、输出和思考的复制入口，保留输出文本转义", () => {
    const html = renderToStaticMarkup(<Stream rows={[
      tool({ ok: true, args: '{"path":"src/example.ts"}', output: "<script>literal</script>" }),
      { kind: "assistant", seq: 1, eventId: 2, round: 1, text: "完成。", thinking: "先检查接口。" },
    ]} view="verbose" streaming={false} actions={{ onCopyText: () => undefined }} />);
    expect(html).toContain('aria-label="复制原始参数"');
    expect(html).toContain('aria-label="复制工具返回内容"');
    expect(html).toContain('aria-label="复制思考记录"');
    expect(html).toContain("&lt;script&gt;literal&lt;/script&gt;");
    expect(html).not.toContain("<script>literal</script>");
  });

  it("工具组收起态给总耗时，思考复制入口挂在行头而不是正文里", () => {
    const html = renderToStaticMarkup(<Stream rows={[
      tool({ ok: true, ts: 1_000, then: 1_500 }),
      tool({ seq: 1, tool: "edit_file", ok: true, ts: 1_500, then: 2_000 }),
    ]} view="normal" streaming={false} />);
    expect(html).toContain('class="tool-group-duration"');
    expect(html).toContain("1.0s");
    const think = renderToStaticMarkup(
      <ThinkingLive seq={1} thinking="先检查接口。" running={false} view="normal" onCopyText={() => undefined} />,
    );
    // 复制钮在 think-body 之前（行头），不再占掉正文前的 30px。
    expect(think.indexOf("thinking-actions")).toBeGreaterThan(-1);
    expect(think.indexOf("thinking-actions")).toBeLessThan(think.indexOf("think-body"));
  });

  it("时间戳倒置或无效时不渲染虚假的零毫秒耗时", () => {
    for (const then of [10, Number.NaN]) {
      const html = renderToStaticMarkup(<Stream rows={[tool({ ok: true, ts: 20, then })]} view="verbose" streaming={false} />);
      expect(html).not.toContain('class="tdur"');
      expect(html).not.toContain("0ms");
    }
  });
});

describe("工具与思考的收起态排版", () => {
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const processCss = readFileSync(new URL("../src/renderer/components/stream-process.css", import.meta.url), "utf8");

  it("工具主状态与失败摘要分行，失败摘要最多占两行", () => {
    const html = renderToStaticMarkup(<Stream rows={[tool({ ok: false, output: "Permission denied" })]} view="normal" />);
    expect(html).toContain('class="tool-group-main"');
    expect(css).toMatch(/\.tool-group-main\s*{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.tool-group-failure\s*{[^}]*display:\s*-webkit-box/s);
    expect(css).toMatch(/\.tool-group-failure\s*{[^}]*-webkit-line-clamp:\s*2/s);
    expect(css).toMatch(/\.tool-group-failure\s*{[^}]*max-width:\s*72ch/s);
    // 2026-10-28 第 738 页：过程轨 13px，失败摘要有极淡危险色底（不是彩色左条）。
    expect(processCss).toMatch(/\.toolcluster \.tool-group-toggle\s*{[^}]*font-size:\s*var\(--fs-caption-md\)/s);
    expect(processCss).toMatch(/\.toolcluster \.tool-group-failure\s*{[^}]*background:\s*hsl\(var\(--color-risk\) \/ 6%\)/s);
  });

  it("完成态字形不套深色底，思考体只保留内层一根竖线（真机暗色 2026-11-01）", () => {
    // 暗色主题里 bg-200 = #0a0a0a，22px 芯片读成一枚嵌在行里的黑键。
    expect(processCss).toMatch(/\.toolcluster \.tool-group-main > \.glyph,[\s\S]*?background:\s*transparent/s);
    // 展开的思考体此前外层 border-left + inner border-left 并排成两根线。
    const bodyRule = processCss.match(/\.row\.think \.think-body \{([^}]*)\}/s)?.[1] ?? "";
    expect(bodyRule).not.toMatch(/(^|\n)\s*border-left\s*:/);
    expect(processCss).toMatch(/\.row\.think \.think-icon \{[^}]*background:\s*transparent/s);
  });

  it("思考标签不被长摘要挤扁（真机 2026-11-01：标签被摘要压住看起来叠字）", () => {
    expect(processCss).toMatch(/\.row\.think \.think-main\s*\{[^}]*flex:\s*none/s);
    expect(processCss).toMatch(/\.row\.think \.think-label\s*\{[^}]*white-space:\s*nowrap/s);
    expect(processCss).toMatch(/\.row\.think \.think-preview\s*\{[^}]*flex:\s*1 1 auto/s);
  });

  it("思考标题与计时占主行，摘要独占次级行并截断", () => {
    const html = renderToStaticMarkup(<ThinkingLive seq={1} thinking="先检查接口。" running={false} view="normal" />);
    expect(html).toContain('class="think-main"');
    expect(css).toMatch(/\.think-main\s*{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.think-elapsed\s*{[^}]*margin-left:\s*auto/s);
    expect(css).toMatch(/\.think-preview\s*{[^}]*display:\s*-webkit-box/s);
  });
});
