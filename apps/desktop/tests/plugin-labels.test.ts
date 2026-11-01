// 插件来源/作用域的单一词表（第 928 页）：三份手抄本此前漂成两套说法——
// 同一个 local，安装卡写「本地目录」、列表与发现页写「本地」；runtime 只有列表认「手动」。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { categoryLabel, scopeLabelOf, sourceKindLabel } from "../src/renderer/components/plugins/labels";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("插件标签一把尺", () => {
  it("来源四种：官方目录 / Git / 本地目录 / 手动（runtime）", () => {
    expect(sourceKindLabel("catalog")).toBe("官方目录");
    expect(sourceKindLabel("git")).toBe("Git");
    expect(sourceKindLabel("local")).toBe("本地目录"); // 改前列表页与发现页写的是「本地」
    expect(sourceKindLabel("runtime")).toBe("手动");
  });

  it("作用域两种：user = 全局，project = 当前项目", () => {
    expect(scopeLabelOf("user")).toBe("全局");
    expect(scopeLabelOf("project")).toBe("当前项目");
  });

  it("三张卡都读同一份：没有第二份手抄本", () => {
    const files = ["PluginInstalled.tsx", "PluginDiscover.tsx", "PluginReview.tsx"];
    for (const f of files) {
      const src = read(`../src/renderer/components/plugins/${f}`);
      expect(src, `${f} 没读 labels.ts`).toContain('from "./labels"');
      expect(src, `${f} 还留着自己的 sourceLabel`).not.toContain("function sourceLabel");
      expect(src, `${f} 还留着自己的 scopeLabel`).not.toContain("function scopeLabel");
    }
    const labels = read("../src/renderer/components/plugins/labels.ts");
    // 词只在这里出现一次：别的文件里再写「本地目录」就是又抄了一份
    const copies = files.filter((f) => read(`../src/renderer/components/plugins/${f}`).includes('"本地目录"'));
    expect(copies, "除 labels.ts 之外还有文件直接写「本地目录」：" + copies.join(" | ")).toEqual([]);
    expect(labels).toContain('return "本地目录";');
  });
});

// 第 935 页：插件「组成」的六类此前两套写法——发现页是中文（智能体/钩子），
// 详情抽屉直接摆英文键名（`agents N · hooks N`），还夹在「技能 / 命令」中间。
describe("插件类目词表", () => {
  it("六类全中文（MCP / LSP 是专名，原样）", () => {
    expect(categoryLabel("skills")).toBe("技能");
    expect(categoryLabel("commands")).toBe("命令");
    expect(categoryLabel("agents")).toBe("智能体");
    expect(categoryLabel("hooks")).toBe("钩子");
    expect(categoryLabel("mcp")).toBe("MCP");
    expect(categoryLabel("lsp")).toBe("LSP");
  });

  it("发现页与详情抽屉读同一份；抽屉不再直接写英文键名", () => {
    const discover = read("../src/renderer/components/plugins/PluginDiscover.tsx");
    expect(discover).toContain("PLUGIN_CATEGORY_LABEL");
    expect(discover).not.toContain("const CATEGORY_LABEL");
    const page = read("../src/renderer/components/AppPage.tsx");
    expect(page).toContain('import { categoryLabel } from "./plugins/labels"');
    expect(page).toContain('categoryLabel("agents")');
    expect(page).toContain('categoryLabel("hooks")');
    expect(page).not.toContain("· agents {String(");
    expect(page).not.toContain("· hooks {String(");
  });
});
