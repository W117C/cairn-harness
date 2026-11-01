// 批准卡的人话覆盖（第 941 页）：闸门面（`src/main/tool-gates.ts` 的 `GatedName`）里每一把工具，
// 弹批准卡时都必须有自己的那一句；少了就落到兜底「需要你批准 + 参数 JSON」——批的是哪件事看不出来。
// 第 15 / 17 / 18 轮分别补过名单外工具、读族与补丁的抬头；这条判据把它变成「一份名单对一份人话」。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeAsk } from "../src/renderer/components/cards";

const ROOT = join(import.meta.dirname, "..", "..", "..");

/** 从闸门源码里取 `type GatedName = "a" | "b" | …;`（类型在运行时没有实体，只能读声明）。 */
function gatedNames(): string[] {
  const src = readFileSync(join(ROOT, "src/main/tool-gates.ts"), "utf8");
  const m = /type GatedName =([^;]+);/u.exec(src);
  if (m === null) return [];
  return [...m[1]!.matchAll(/"([a-z_]+)"/gu)].map((x) => x[1]!);
}

describe("闸门面每一把工具在批准卡上都有自己的人话（第 941 页）", () => {
  it("清单本身先得取到（正则坏了这条会先红，而不是空跑成绿）", () => {
    const names = gatedNames();
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names).toContain("run_shell");
    expect(names).toContain("apply_patch");
  });

  it("每一把都给出人话标题（不落「需要你批准」兜底）", () => {
    const missing: string[] = [];
    for (const tool of gatedNames()) {
      const digest = describeAsk({ tool, args: {} });
      if (digest.title === "需要你批准") missing.push(tool);
    }
    expect(missing, "这些闸门工具还没有自己的人话标题，会落到兜底 JSON：" + missing.join(" | ")).toEqual([]);
  });

  it("标题不重复到读不出区别（每把工具一个动作名）", () => {
    const titles = gatedNames().map((tool) => describeAsk({ tool, args: {} }).title);
    const dup = titles.filter((t, i) => titles.indexOf(t) !== i);
    expect(dup, "两个闸门工具共用一个标题，卡上读不出是哪件事：" + dup.join(" | ")).toEqual([]);
  });
});
