import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Stream, ThinkingLive } from "../src/renderer/components/Stream";
import { toolFailureReasonOf, toolFailureSummary } from "../src/renderer/derived/tool-failure";
import { STR } from "../src/renderer/strings";
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

  it("运行中步骤在摘要中可见，失败只给一行人话（原文退到悬停提示里），完整列表保持收起", () => {
    const html = renderToStaticMarkup(<Stream rows={[
      tool({ ok: false, output: "Permission denied: src/example.ts" }),
      tool({ seq: 1, tool: "run_shell", summary: "pnpm test", pending: true }),
    ]} view="normal" />);
    expect(html).toContain("执行中 · 运行 pnpm test");
    // 2026-11-02：失败数与总数合成一句（见 tool-group-label）。
    expect(html).toContain("1 次工具失败（共 2 次）");
    // 2026-11-01 真机缺陷 1：收起卡不再摆机器面原文（原样是写给模型读的解释面），
    // 只给一行人话；原文仍可达——悬停提示（title）里给截断版。
    expect(html).toContain("read_file 调用失败");
    expect(html).toContain("原始报错：Permission denied: src/example.ts");
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
  /** 去掉 CSS 注释：判据只看声明本身（注释里复述旧写法不算犯规）。 */
  const decls = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "");

  it("工具主状态与失败摘要分行，失败摘要最多占两行", () => {
    const html = renderToStaticMarkup(<Stream rows={[tool({ ok: false, output: "Permission denied" })]} view="normal" />);
    expect(html).toContain('class="tool-group-main"');
    expect(css).toMatch(/\.tool-group-main\s*{[^}]*display:\s*flex/s);
    // 2026-11-01 真机订正：clamp 与卡片 padding 同元素叠加会漏第三行 ⇒ 截断移到内层 detail。
    expect(css).toMatch(/\.tool-group-failure\s*{[^}]*max-width:\s*72ch/s);
    expect(css).toMatch(/\.tool-group-failure-detail\s*{[^}]*display:\s*-webkit-box/s);
    expect(css).toMatch(/\.tool-group-failure-detail\s*{[^}]*-webkit-line-clamp:\s*2/s);
    // 2026-10-28 第 738 页：过程轨 13px。2026-11-02 再收一档：失败摘要去底，
    // 是组摘要红三角的一句话副行，不是一张孤立小卡。
    expect(processCss).toMatch(/\.toolcluster \.tool-group-toggle\s*{[^}]*font-size:\s*var\(--fs-caption-md\)/s);
    expect(processCss).not.toMatch(/\.toolcluster \.tool-group-failure\s*{[^}]*background:/s);
  });

  it("截断不与卡片 chrome 同层（2026-11-01 真机：第三行漏出、卡底拦腰切字）", () => {
    // clamp 只许落在内层 .tool-group-failure-detail（无 padding 的纯文字盒）；
    // 卡片层 .tool-group-failure 只管底/圆角/占位——两层叠加时 Chromium 会把第三行漏出来。
    const failureRule = decls(css).match(/\.tool-group-failure\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(failureRule).not.toMatch(/-webkit-line-clamp/);
    expect(failureRule).not.toMatch(/-webkit-box/);
    expect(failureRule).not.toMatch(/overflow:\s*hidden/);
    // 孤行调整（text-wrap: pretty）与 line-clamp 同框会漏行 ⇒ 过程轨里不许再写它。
    const clusterRule = decls(processCss).match(/\.toolcluster \.tool-group-failure\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(clusterRule).not.toMatch(/text-wrap:\s*pretty/);
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

describe("工具失败的人话摘要（2026-11-01 真机缺陷 1：收起卡摆的是机器面原文）", () => {
  const copy = STR.toolGroup;

  it("gate 判定说了算：超时 / 无人值守 / 门拦 / 人拒，各一句人话", () => {
    expect(toolFailureSummary({ tool: "web_fetch", gateVerdict: "timeout" }, copy))
      .toBe("web_fetch 未执行 · 审批等待超时（无人应答即按拒绝收束）");
    expect(toolFailureSummary({ tool: "web_fetch", gateVerdict: "unattended" }, copy))
      .toBe("web_fetch 未执行 · 无人值守模式下被拒绝");
    expect(toolFailureSummary({ tool: "web_fetch", gateVerdict: "denied" }, copy))
      .toBe("web_fetch 未执行 · 被权限门拒绝");
    expect(toolFailureSummary({ tool: "web_fetch", gateVerdict: "rejected" }, copy))
      .toBe("web_fetch 未执行 · 执行被拒绝");
  });

  it("没有 gate 留痕时认机器面原文的特征片段（壳里的那一句优先于壳本身）", () => {
    expect(toolFailureReasonOf({ tool: "web_fetch", output: "[permission denied] web_fetch 在 full-access 档下被门拒绝（审批等待超时（无人应答即按拒绝收束）——该工具没有执行。）" })).toBe("timeout");
    expect(toolFailureReasonOf({ tool: "web_fetch", output: "[permission denied] web_fetch 在 default 档下被门拒绝（无人值守 fail-closed：这一轮没有任何人能回应审批，审批请求被立即拒绝——该工具没有执行。）" })).toBe("unattended");
    expect(toolFailureReasonOf({ tool: "web_fetch", output: "[permission denied] web_fetch 在 default 档下被门拒绝（用户明确拒绝了这次审批——该工具没有执行。）" })).toBe("rejected");
    expect(toolFailureReasonOf({ tool: "web_fetch", output: "[permission denied] web_fetch 在 default 档下被门拒绝（工具门未接线（fail-closed））" })).toBe("denied");
  });

  it("门放行了但工具自己失败 ⇒ 兜底「调用失败」（不谎称没执行，也不冒充成功）", () => {
    expect(toolFailureSummary({ tool: "web_fetch", gateVerdict: "approved", output: "boom" }, copy)).toBe("web_fetch 调用失败");
    expect(toolFailureSummary({ tool: "web_fetch", output: "Assertion failed" }, copy)).toBe("web_fetch 调用失败");
  });

  it("收起卡：一行人话上屏，机器面原文只留在悬停提示里", () => {
    const raw = "[permission denied] web_fetch 在 full-access 档下被门拒绝（审批等待超时（无人应答即按拒绝收束）——该工具没有执行。）";
    const html = renderToStaticMarkup(<Stream rows={[tool({ tool: "web_fetch", ok: false, output: raw })]} view="normal" />);
    // 收起卡上摆的就是这一行（原文不上屏）。
    const detail = html.match(/class="tool-group-failure-detail">([^<]*)</)?.[1] ?? "";
    expect(detail).toBe("web_fetch 未执行 · 审批等待超时（无人应答即按拒绝收束）");
    // 原文仍可达：悬停提示（title；展开体里另有全文 <pre>）。
    const title = html.match(/class="tool-group-failure" title="([^"]*)"/)?.[1] ?? "";
    expect(title).toContain("原始报错：[permission denied] web_fetch 在 full-access 档下被门拒绝");
  });
});

describe("工具组标题（2026-11-03 业主「1 次工具调用 执行中」）", () => {
  it("单次调用直接写动词+对象，不写「1 次工具调用」", () => {
    const html = renderToStaticMarkup(<Stream rows={[tool({ tool: "read_file", summary: "src/main/settings.ts", pending: true })]} view="normal" streaming />);
    expect(html).toContain("读取 src/main/settings.ts");
    expect(html).not.toContain("1 次工具调用");
    expect(html).toContain("执行中");
  });

  it("多次调用仍报总数（单次才收成人话标题）", () => {
    const html = renderToStaticMarkup(<Stream rows={[tool({ seq: 0 }), tool({ seq: 1 })]} view="normal" streaming />);
    expect(html).toContain("2 次工具调用");
  });
});

describe("思考块配色（2026-11-03 业主「颜色有问题」）", () => {
  const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const processCss = readFileSync(new URL("../src/renderer/components/stream-process.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (text: string, selector: RegExp): string => text.match(selector)?.[0] ?? "";

  it("运行光场不再用品牌橙：浅色主题下那层陶土橙会染成粉红/肉色，思考块看着像报错", () => {
    const glow = rule(css, /\.row\.think\[data-running="true"\]::before\s*\{[^}]*\}/s);
    expect(glow).not.toBe("");
    expect(glow).not.toContain("--accent-brand");
    expect(glow).toContain("hsl(var(--text-000) / 6%)");
  });

  it("正文比 secondary 深一档：primary 的 86%，两处 color 声明同口径（改一处漏一处会漂）", () => {
    const inner = rule(css, /\.think-body-inner\s*\{[^}]*\}/s);
    expect(inner).toContain("hsl(var(--text-000) / 86%)");
    expect(inner).not.toContain("hsl(var(--text-300))");
    const body = rule(processCss, /\.row\.think \.think-body\s*\{[^}]*\}/s);
    expect(body).toContain("hsl(var(--text-000) / 86%)");
    const md = rule(processCss, /\.row\.think \.think-text \.md-body\s*\{[^}]*\}/s);
    expect(md).toContain("hsl(var(--text-000) / 86%)");
  });

  it("标题也从 secondary 提亮/加深：静态 72%、运行 88%", () => {
    expect(rule(processCss, /\.row\.think \.think-label\s*\{[^}]*\}/s)).toContain("hsl(var(--text-000) / 72%)");
    expect(rule(processCss, /\.row\.think\[data-running="true"\] \.think-label\s*\{[^}]*\}/s)).toContain("hsl(var(--text-000) / 88%)");
  });
});
