import { describe, expect, it } from "vitest";
import { extractTaskPaths, TASK_PATHS_MAX } from "../src/agent/evolve/task-context.js";

describe("进化检索的任务路径线索", () => {
  it("从任务原文取 workspace 相对路径；URL 尾巴不当路径；去重保序", () => {
    const text = "看 src/parser.ts 和 ./docs/README.md；别管 https://example.com/a.ts，再看 src/parser.ts";
    expect(extractTaskPaths(text)).toEqual(["src/parser.ts", "docs/README.md"]);
  });

  it("workspace 下的绝对路径归一成相对；工作区外的绝对路径丢弃", () => {
    expect(extractTaskPaths("改 /w/proj/src/a.ts 与 /tmp/other.ts", { workspace: "/w/proj/" }))
      .toEqual(["src/a.ts"]);
  });

  it("封顶；裸目录与版本串不算路径", () => {
    const many = Array.from({ length: TASK_PATHS_MAX + 4 }, (_, i) => `f${String(i)}.ts`).join(" ");
    expect(extractTaskPaths(many)).toHaveLength(TASK_PATHS_MAX);
    expect(extractTaskPaths("版本 1.2，目录 src/")).toEqual([]);
  });

  it("空文本与零帽 = 空", () => {
    expect(extractTaskPaths("")).toEqual([]);
    expect(extractTaskPaths("a.ts", { max: 0 })).toEqual([]);
  });
});
