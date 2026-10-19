// stripMarkdownForSpeech 判卷（§2.2 read aloud 的文本面）：钉「念内容不念记号」的核心行为。
import { describe, expect, it } from "vitest";
import { stripMarkdownForSpeech } from "../src/renderer/speech";

describe("stripMarkdownForSpeech（朗读文本轻剥）", () => {
  it("标题/粗体/行内码/链接：剥记号留内容", () => {
    expect(stripMarkdownForSpeech("## 结论")).toBe("结论");
    expect(stripMarkdownForSpeech("这是 **加粗** 的")).toBe("这是 加粗 的");
    expect(stripMarkdownForSpeech("跑 `pnpm test` 看看")).toBe("跑 pnpm test 看看");
    expect(stripMarkdownForSpeech("见 [文档](https://example.com/x) 一节")).toBe("见 文档 一节");
  });

  it("围栏代码：留代码正文、去语言标签与围栏", () => {
    const md = "示例：\n```ts\nconst a = 1;\n```\n完毕";
    expect(stripMarkdownForSpeech(md)).toBe("示例： const a = 1; 完毕");
  });

  it("列表/引用/图片：剥行首记号；图片取替代文本", () => {
    expect(stripMarkdownForSpeech("- 第一项\n- 第二项")).toBe("第一项 第二项");
    expect(stripMarkdownForSpeech("> 引用一段")).toBe("引用一段");
    expect(stripMarkdownForSpeech("![架构图](a.png)")).toBe("架构图");
  });

  it("无标记纯文本原样（压缩空白后）；空串仍是空串", () => {
    expect(stripMarkdownForSpeech("直接一句话。")).toBe("直接一句话。");
    expect(stripMarkdownForSpeech("  多   空格\n换行 ")).toBe("多 空格 换行");
    expect(stripMarkdownForSpeech("")).toBe("");
  });
});
