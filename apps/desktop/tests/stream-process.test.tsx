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

  it("时间戳倒置或无效时不渲染虚假的零毫秒耗时", () => {
    for (const then of [10, Number.NaN]) {
      const html = renderToStaticMarkup(<Stream rows={[tool({ ok: true, ts: 20, then })]} view="verbose" streaming={false} />);
      expect(html).not.toContain('class="tdur"');
      expect(html).not.toContain("0ms");
    }
  });
});
