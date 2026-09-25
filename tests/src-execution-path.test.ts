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
import { readFileSync } from "node:fs";

import { analyze } from "../scripts/lib/reach-graph";

const ROOT = resolve(__dirname, "..");
const reach = analyze(ROOT);

/** 例外表：**运行时是空的**那些文件（纯契约面）本来就没有可执行的东西，"没有执行路径"是事实不是缺口。
 *  豁免不靠"看着像类型文件"这种写法判断（换写法即绕过，规则 122），靠**真去 import 它**：
 *  下面第三条用例要求运行时导出为 0——哪天有人往里加一个 `export const`，豁免立刻失效并点名。 */
const TYPE_ONLY_SURFACE: readonly string[] = ["src/main/ipc-protocol.ts"];

/** 桌面层入口：headless vitest **结构上**不可能有它的判卷面（`import` 它就是启动 Electron），
 *  所以零执行路径是这一族的固有属性，不是"谁忘了写测试"。
 *  为什么写成路径集合而不是"盘上有没有 src/preload/"：前者是待证的事实，后者是此刻的工作树状态。 */
const ELECTRON_ENTRIES: readonly string[] = ["src/main/index.ts", "src/preload/index.ts"];

/** 真去读它、确认它确实引 Electron——豁免同样必须可反证：哪天那层剥干净了（改成注入式启动），
 *  这条成因就失效，那两个入口必须补判卷面或从名单删名。 */
function importsElectron(rel: string): boolean {
  let text = "";
  try { text = readFileSync(join(ROOT, rel), "utf8"); } catch { return false; }
  return /from\s+["']electron["']|require\(\s*["']electron["']\s*\)/.test(text);
}

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

  // 以前这里写成「缺口 = 那张手抄清单」。它读的是**工作树**：桌面层那笔删除未入库时缺口只有 1 个，
  // 入库前在 HEAD 上跑就是红（我自己造的第 83 页那簇 ❌ 里的一条）。判据要的是成因，不是此刻的名单。
  it("缺口必须逐个命中可机检的成因（纯类型面 / Electron 入口），否则就是真没尺", () => {
    const gaps = reach.src.filter((f) => !reach.live.has(f)).sort();
    const unexplained: string[] = [];
    for (const gap of gaps) {
      if (TYPE_ONLY_SURFACE.includes(gap)) continue; // 运行时零导出 ⇒ 没有可执行的东西（下一条用例逐条证明）
      if (ELECTRON_ENTRIES.includes(gap) && importsElectron(gap)) continue; // headless 判卷面结构上引不了它
      unexplained.push(gap);
    }
    expect(unexplained, `这些 src 模块没有任何从测试出发的执行路径，且不属于两类已知成因 ⇒ 给它们写测试，或（带理由）加进例外表`).toEqual([]);
  });

  // 反向一侧（规则 60/78）：只断"缺口都能解释"会放过"名单里躺着已经不需要豁免的文件"——
  // 那种文件此刻有执行路径，豁免就成了永不生效的装饰。
  it("例外名单不得含此刻已有执行路径的文件（僵尸豁免要红）", () => {
    const zombie = [...TYPE_ONLY_SURFACE, ...ELECTRON_ENTRIES].filter((f) => reach.src.includes(f) && reach.live.has(f));
    expect(zombie, "这些文件已在例外名单里，但其实有测试执行它 ⇒ 从名单删名").toEqual([]);
  });

  it("每条例外都要证明它运行时真的什么都没有（不许用注释自称类型面来换豁免）", async () => {
    for (const rel of TYPE_ONLY_SURFACE) {
      const mod = (await import(pathToFileURL(join(ROOT, rel)).href)) as Record<string, unknown>;
      const runtimeExports = Object.keys(mod);
      expect(runtimeExports, `${rel} 已经不只是类型面（运行时导出：${runtimeExports.join(",")}）⇒ 给它写测试，或从例外表删名`).toEqual([]);
    }
  });

  it("假覆盖要出声：只有类型边连着测试的文件，不得偷偷算作已覆盖", () => {
    const fakeCover = reach.src.filter((f) => reach.all.has(f) && !reach.naiveLive.has(f)).sort();
    // 今天的真值：唯一一条是纯契约面，它同时也在例外表里 ⇒ 两个集合必须一致
    expect(fakeCover).toEqual([...TYPE_ONLY_SURFACE].sort());
  });

  // 第三种"没执行"：有测试**值引**它，但那个测试 `vi.mock` 把它换成了桩 ⇒ 真实实现一行都没跑。
  // 今天 5 条 vi.mock(src) 都没掩盖掉任何模块（每条被 mock 的边之外另有真执行路径）⇒ 真值是空集；
  // 哪天有人把某模块唯一的测试面 mock 掉，这条会点名它，而不是让"有测试引它"糊过去。
  it("被 mock 掩盖的执行路径必须单独点名（不许混在「有测试引它」里）", () => {
    const mockedAway = reach.src.filter((f) => reach.naiveLive.has(f) && !reach.live.has(f)).sort();
    expect(mockedAway).toEqual([]);
  });
});
