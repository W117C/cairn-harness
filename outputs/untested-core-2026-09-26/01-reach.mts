// 读数 CLI（只读）：`src/` 里哪些模块在盘上没有从测试出发的执行路径。
// 尺本身在 `scripts/lib/reach-graph.ts`——**与判卷面 `tests/src-execution-path.test.ts` 共用一份**，
// 这里只负责打印分类与 `--why` 的路径追溯（同一判据各抄一份迟早漂）。
// 为什么值得单开一个 CLI：判卷面只说"红"，读数面要说清"红在哪、为什么、离豁免多远"。
// 用法：
//   node --import tsx outputs/untested-core-2026-09-26/01-reach.mts
//   node --import tsx outputs/untested-core-2026-09-26/01-reach.mts --self-test
//   node --import tsx outputs/untested-core-2026-09-26/01-reach.mts --why=src/main/updater.ts
import { mkdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, valuePath, type Reach } from "../../scripts/lib/reach-graph";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

/** 自检：在临时目录造一张**答案已知**的小图，逐条核分类。
 *  不这么做，"几乎全绿"这种读数最可疑（规则 59/65）。第一版就是它抓出我自己写错的期望：
 *  类型边从一条不可达的链路出发，是到不了的——不是尺坏，是我把图想错了。 */
function selfTest(): number {
  const tmp = join(tmpdir(), `reach-selftest-${String(process.pid)}`);
  rmSync(tmp, { recursive: true, force: true });
  const w = (rel: string, text: string): void => {
    const abs = join(tmp, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  };
  w("tests/a.test.ts", 'import { real } from "../src/real";\nimport { helper } from "./helpers/k";\nimport type { Foo } from "../src/type-only";\nreal(); helper(); const f: Foo = { a: 1 };\n');
  w("tests/helpers/k.ts", "export function helper(): number { return 1; }\n");
  w("src/real.ts", 'import { dyn } from "./via-dyn.js";\nexport function real(): number { return dyn(); }\n');
  w("src/via-dyn.ts", "export function dyn(): number { return 2; }\n");
  w("src/type-only.ts", "export interface Foo { a: number }\n");
  w("src/consumer-of-type.ts", 'import type { Foo } from "./type-only";\nexport const x: Foo = { a: 1 };\n');
  w("src/orphan.ts", "export const nobody = 1;\n");
  w("src/barrel/index.ts", 'export { real } from "../real";\n');
  w("tests/b.test.ts", 'import { real } from "../src/barrel";\nreal();\n');
  // mock 那一格：唯一引它的测试把它 `vi.mock` 掉了 ⇒ 真实实现一行都没执行，必须算**缺口**
  w("src/mocked-only.ts", "export function m(): number { return 7; }\n");
  w("tests/c.test.ts", 'import { describe, expect, it, vi } from "vitest";\nvi.mock("../src/mocked-only");\nimport { m } from "../src/mocked-only";\ndescribe("m", () => { it("自动桩", () => { expect(m()).toBeUndefined(); }); });\n');
  const { src, live, all, naiveLive, mocks } = analyze(tmp);
  const want: Array<[string, "live" | "typeonly" | "mocked" | "gap"]> = [
    ["src/real.ts", "live"],            // 测试直接值引
    ["src/via-dyn.ts", "live"],         // 经 `.js` 后缀那条边接上
    ["src/barrel/index.ts", "live"],    // 桶文件本身也跑得到
    ["src/consumer-of-type.ts", "gap"], // 没有任何测试引它
    ["src/type-only.ts", "typeonly"],   // 只有类型边连测试 ⇒ 假覆盖候选
    ["src/orphan.ts", "gap"],           // 谁都不引
    ["src/mocked-only.ts", "mocked"],   // 引它的那个测试把它 mock 了 ⇒ 真实实现没跑
  ];
  const bad: string[] = [];
  for (const [f, expect] of want) {
    if (!src.includes(f)) { bad.push(`${f}：文件没进图（取料面漏了）`); continue; }
    // 三种"没执行"要分得开：全 mock / 只有类型边 / 根本没人引——修的法子完全不同
    const got = live.has(f) ? "live" : naiveLive.has(f) ? "mocked" : all.has(f) ? "typeonly" : "gap";
    if (got !== expect) bad.push(`${f}：期望 ${expect}，尺读出 ${got}`);
  }
  rmSync(tmp, { recursive: true, force: true });
  // 半边之二：`mockedTargets` 真解析到那条 `vi.mock`（只验分类的话，"解析不到 mock"也会给出同样的 gap 答案）
  const seenMocks = mocks.get("tests/c.test.ts") ?? [];
  if (seenMocks.length !== 1 || seenMocks[0] !== "src/mocked-only.ts") {
    bad.push(`mockedTargets：期望 tests/c.test.ts → [src/mocked-only.ts]，读出 ${JSON.stringify(seenMocks)}`);
  }
  if (bad.length > 0) {
    console.log("**尺不可信**：自检失败 " + String(bad.length) + " 条");
    for (const b of bad) console.log("   ✗ " + b);
    return 1;
  }
  console.log("自检：7 条分类 + 1 条 mock 解析全部对上 ✅（值链 / .js 后缀 / 桶文件 / 只有类型边 / 无引 / 孤立 / 被 mock 即未执行）");
  return 0;
}

function report(r: Reach): void {
  const gaps = r.src.filter((f) => !r.live.has(f));
  // 三种"没执行"分开报——修法完全不同：补测试 / 别再只靠 mock / 要么给路径要么同批摘实现
  const mockedAway = gaps.filter((f) => r.naiveLive.has(f));
  const fakeCover = gaps.filter((f) => !r.naiveLive.has(f) && r.all.has(f));
  const never = gaps.filter((f) => !r.all.has(f));
  const gateOnly = gaps.filter((f) => r.gate.has(f));
  const mockEdges = [...r.mocks.values()].reduce((n, v) => n + v.length, 0);
  console.log(`生产面：${String(r.src.length)} 个 .ts（.d.ts 不入图）｜测试入口：${String(r.tests.length)} 个 .test.ts｜vi.mock(src) 边 ${String(mockEdges)} 条`);
  console.log(`真被执行 ${String(r.src.length - gaps.length)} 个 ⇒ **没有执行路径 ${String(gaps.length)} 个**` +
    `＝根本没人引 ${String(never.length)} 个 + 只有类型边 ${String(fakeCover.length)} 个 + 引它的测试全 mock 掉 ${String(mockedAway.length)} 个` +
    `（其中只有门脚本跑得到 ${String(gateOnly.length)} 个）`);
  console.log("");
  for (const f of gaps.sort()) {
    const cause = mockedAway.includes(f) ? "引它的测试把它 mock 掉了（真实实现没跑）"
      : fakeCover.includes(f) ? "只有类型边连着测试（假覆盖候选）" : "没有任何测试引它";
    console.log("  " + f + "   ← " + cause);
  }
  if (gaps.length === 0) console.log("  （无）");
  console.log("");
  console.log("口径：闭包起点＝盘上全部 tests/*.test.ts；`import type` 不计值边；`.d.ts` 不入图。");
  console.log("读数不等于判据：可达＝会被执行，**不代表有断言**。判据在 tests/src-execution-path.test.ts（同一把尺）。");
}

const arg = process.argv[2] ?? "";
if (arg === "--self-test") process.exit(selfTest());

const r = analyze(ROOT);
if (r.tests.length === 0) { console.log("**取料失败**：盘上一个 .test.ts 都没有 ⇒ 图没有起点，别读后面的数"); process.exit(1); }
if (!r.live.has("src/agent/prune.ts")) {
  console.log("**读数不可信**：正控失败——`src/agent/prune.ts` 被判不可达（它有自己的判卷面）。先跑 --self-test");
  process.exit(1);
}

if (arg.startsWith("--why=")) {
  const target = arg.slice("--why=".length);
  const chain = valuePath(r, target);
  if (chain === null) { console.log(`没有值边路径从任何 tests/*.test.ts 通向 ${target}（或该路径不在图里）`); process.exit(0); }
  console.log(`值边路径（${String(chain.length - 1)} 跳）：`);
  for (const c of chain) console.log("  " + c);
  process.exit(0);
}

if (!existsSync(join(ROOT, "src"))) { console.log("**取料失败**：没有 src/ 目录"); process.exit(1); }
report(r);
