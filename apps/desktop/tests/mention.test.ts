// mention 纯函数判卷（P2-4 改薄）：触发解析（词首 @ / 段断——判据一字未动）+ 替换 + 面包屑拆分。
// 逐层下钻的旧语义（mentionTarget / mentionCompletion / filterMentionEntries）随 @ 走
// workspaceSearch 模糊搜索下架——删面不接线（判卷钉不再引用）。
import { describe, expect, it } from "vitest";
import { mentionBreadcrumb, parseMentionQuery, replaceMentionToken } from "../src/renderer/mention";

describe("parseMentionQuery（触发解析）", () => {
  it("词首 @ 触发；query 为 @ 后到光标的内容", () => {
    expect(parseMentionQuery("看看 @src/ma", 10)).toEqual({ start: 3, query: "src/ma" });
    expect(parseMentionQuery("@ab", 3)).toEqual({ start: 0, query: "ab" });
  });

  it("空白断段：@ 后出现过空白 ⇒ 不触发", () => {
    expect(parseMentionQuery("@src/main index", 14)).toBeNull();
    expect(parseMentionQuery("hello @ 后空一格", 8)).toBeNull();
  });

  it("词内 @ 不触发（邮箱/代码标识不误触）", () => {
    expect(parseMentionQuery("a@b", 3)).toBeNull();
    expect(parseMentionQuery("user@example.co", 15)).toBeNull();
  });

  it("多个 @ 取光标前最近一个；@ 之后又出现 @ ⇒ 段断", () => {
    expect(parseMentionQuery("@a @b", 5)).toEqual({ start: 3, query: "b" });
    expect(parseMentionQuery("@a@b", 4)).toBeNull();
  });

  it("光标在中段：只看光标之前", () => {
    expect(parseMentionQuery("@src 后面的字", 4)).toEqual({ start: 0, query: "src" });
  });
});

describe("replaceMentionToken（applyMention 改名保语义）", () => {
  it("替换 [start, caret) 段", () => {
    expect(replaceMentionToken("看 @src/ma 这里", 2, 9, "@src/main/")).toBe("看 @src/main/ 这里");
  });

  it("清 token（选中文件 = 删 @段 只留 chip）：replacement 空串", () => {
    // 纯 splice 语义：两侧空白原样保留（界面侧 chip 是可视化真相，不吃这枚空格）。
    expect(replaceMentionToken("看看 @src/ma 的代码", 3, 10, "")).toBe("看看  的代码");
    expect(replaceMentionToken("@a", 0, 2, "")).toBe("");
  });

  it("目录定范围：replacement = @目录/（后续查询在该范围再搜）", () => {
    expect(replaceMentionToken("看 @src 了", 2, 6, "@src/main/")).toBe("看 @src/main/ 了");
  });
});

describe("mentionBreadcrumb（相对路径 → 面包屑拆分）", () => {
  it("根层文件：dir 为空、name 全量", () => {
    expect(mentionBreadcrumb("README.md")).toEqual({ dir: "", name: "README.md" });
  });

  it("深层文件：name = 末段、dir = 其余（灰字 breadcrumb）", () => {
    expect(mentionBreadcrumb("src/renderer/components/Composer.tsx")).toEqual({
      dir: "src/renderer/components",
      name: "Composer.tsx",
    });
  });

  it("目录命中（尾斜杠/无斜杠都认）：name 仍是末段", () => {
    expect(mentionBreadcrumb("src/renderer/")).toEqual({ dir: "src", name: "renderer" });
    expect(mentionBreadcrumb("src")).toEqual({ dir: "", name: "src" });
  });
});

// 2026-10-17：没有项目时 @ 不再静默（placeholder 说 @ 能引用文件，按了没反应是死路）。
describe("无项目时的 @ 回执（源码哨兵）", () => {
  it("Composer 在 wsPath === null 时摆说明行，而不是 return null", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("../src/renderer/components/Composer.tsx", import.meta.url)), "utf8");
    const start = src.indexOf("const refreshMention");
    const block = src.slice(start, start + 900);
    expect(block).toContain("mentionNoWorkspace");
    expect(block).toContain("wsPath === null");
    // 只敲 @ 还没敲字：给「输入文件名开始搜索」，空查询不发搜索请求。
    expect(block).toContain("mentionTypeHint");
    expect(block).toContain('parsed.query === ""');
  });
});
