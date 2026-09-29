// 第 220 页（#34 剩下的那一问）：**首轮注入的地图正文，会在会话中途漏掉多少东西**
//
// 政策问题是「要不要每轮重送」，而它的一半不是钱（第 213 页量过：919 token、50 轮 $0.06–0.09），
// 是** staleness**：会话跑到第 N 轮，仓库已经被这个 agent 自己改过了，模型手里那份首轮地图还剩下多少是真的。
// 靶子放在 OS 临时目录（判卷纪律：测试数据不落工作区；规则 296——共享工作树里自己写盘会污染被度量面）。
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMapBuilder, buildMap, mapInjectText } from "../../src/agent/map/build";

const dir = mkdtempSync(join(tmpdir(), "dsh-map-stale-"));
const put = (name: string, body: string): void => { writeFileSync(join(dir, name), body, "utf8"); };

// 基线仓库：6 个文件、每个一个 def、彼此引用（让图有边、排名有区分度）
const base = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
base.forEach((n, i) => {
  const next = base[(i + 1) % base.length];
  put(`${n}.ts`, `export function ${n}(): number {\n  return ${next}() + 1;\n}\nfunction ${next}(): number { return 0; }\n`);
});

const NEW = ["golf", "hotel", "india"];
const tokenCount = (t: string): number => t.split(/\s+/).filter(Boolean).length;
const hits = (t: string, names: string[]): string[] => names.filter((n) => t.includes(n));

const builder = createMapBuilder({ workspace: dir, budgetTokens: 1200 });

const t1 = mapInjectText(await builder.build({ workspace: dir, budgetTokens: 1200, nowRound: 0 })) ?? "";
const t1Fresh = mapInjectText(await buildMap({ workspace: dir, budgetTokens: 1200 })) ?? "";

NEW.forEach((n, i) => {
  put(`${n}.ts`, `export function ${n}(): string {\n  return ${base[i] ?? "alpha"}();\n}\n`);
});

// 同一个 builder（真会话就是持有一个实例）：新建 3 个文件之后再要一次
const t2 = mapInjectText(await builder.build({ workspace: dir, budgetTokens: 1200, nowRound: 1 })) ?? "";
// 全新实例：无缓存的"地面真值"
const t3 = mapInjectText(await buildMap({ workspace: dir, budgetTokens: 1200 })) ?? "";

console.log("靶子=" + dir);
console.log(`首轮地图正文：字符=${String(t1.length)} 词元≈${String(tokenCount(t1))} · 与全新构建逐字相同=${String(t1 === t1Fresh)}`);
console.log(`首轮那份里含新建符号 ${JSON.stringify(NEW)} 的个数=${String(hits(t1, NEW).length)} ⇒ 政策若保持「只在首轮注入」，模型中途看到的新符号数=0（这是构造事实，不是测量）`);
console.log(`同实例第 2 次 build（round=1）：字符=${String(t2.length)} · 命中新符号=${JSON.stringify(hits(t2, NEW))}`);
console.log(`全新实例（地面真值）：字符=${String(t3.length)} · 命中新符号=${JSON.stringify(hits(t3, NEW))}`);
console.log(`同实例第 2 次是否直接复用首轮正文（=缓存没认出文件集变了）=${String(t2 === t1)}`);
console.log(`第 2 次与全新构建逐字相同=${String(t2 === t3)}（不同 ⇒ 同实例那次仍带着缓存/排名旧序，这就是「重送不等于送对」的那一半）`);
rmSync(dir, { recursive: true, force: true });
