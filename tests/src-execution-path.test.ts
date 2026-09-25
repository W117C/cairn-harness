// 棘轮：`src/` 里每个模块都必须有**从测试出发的执行路径**（第 80 页）。
// 动因（第 79 页实测）：桌面层那笔删除把 `tests/updater.test.ts` 摘掉后，`src/main/updater.ts`
// （https-only SSRF 闸、openExternal 协议白名单、1MB 响应帽）在整棵树里一条测试都不引它，
// 而这件事**没有任何门会红**——`--check-needles` 只看锚点字面量，全量 `test` 只看还在的测试。
// 本判据用 `scripts/lib/reach-graph.ts`（与读数脚本共用同一把尺，不各抄一份）沿 import 图做闭包。
//
// 关键口径：`import type` 是**假覆盖**——vitest 运行时把类型边整个擦掉，
// 所以"有测试引它"不等于"有测试执行它"。只算值边。
import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

import { analyze } from "../scripts/lib/reach-graph";

const ROOT = resolve(__dirname, "..");
const reach = analyze(ROOT);

/** 例外表：**运行时是空的**那些文件（纯契约面）本来就没有可执行的东西，"没有执行路径"是事实不是缺口。
 *  豁免不靠"看着像类型文件"这种写法判断（换写法即绕过，规则 122），靠**真去 import 它**：
 *  下面第三条用例要求运行时导出为 0——哪天有人往里加一个 `export const`，豁免立刻失效并点名。 */
const TYPE_ONLY_SURFACE: readonly string[] = ["src/main/ipc-protocol.ts"];

describe("src/ 的每个模块都要有从测试出发的执行路径", () => {
  it("取料面自己非空（扫到 0 个文件＝没尺，不许把空清单当通过）", () => {
    expect(reach.src.length).toBeGreaterThan(50);
    expect(reach.tests.length).toBeGreaterThan(50);
  });

  it("尺自己：已知有判卷面的模块必须判为可达（认不出它＝图坏了，后面的断言全不算数）", () => {
    for (const known of ["src/agent/prune.ts", "src/tools/output-ring.ts", "src/main/updater.ts"]) {
      expect(reach.live.has(known), `${known} 有自己的测试却判为不可达`).toBe(true);
    }
  });

  it("缺口清单必须与例外表逐字相等（新增未测模块即红；例外表里已不再缺路径的也要删名）", () => {
    const gaps = reach.src.filter((f) => !reach.live.has(f)).sort();
    expect(gaps).toEqual([...TYPE_ONLY_SURFACE].sort());
  });

  it("每条例外都要证明它运行时真的什么都没有（不许用注释自称类型面来换豁免）", async () => {
    for (const rel of TYPE_ONLY_SURFACE) {
      const mod = (await import(pathToFileURL(join(ROOT, rel)).href)) as Record<string, unknown>;
      const runtimeExports = Object.keys(mod);
      expect(runtimeExports, `${rel} 已经不只是类型面（运行时导出：${runtimeExports.join(",")}）⇒ 给它写测试，或从例外表删名`).toEqual([]);
    }
  });

  it("假覆盖要出声：只有类型边连着测试的文件，不得偷偷算作已覆盖", () => {
    const fakeCover = reach.src.filter((f) => reach.all.has(f) && !reach.live.has(f)).sort();
    // 今天的真值：唯一一条是纯契约面，它同时也在例外表里 ⇒ 两个集合必须一致
    expect(fakeCover).toEqual([...TYPE_ONLY_SURFACE].sort());
  });
});
