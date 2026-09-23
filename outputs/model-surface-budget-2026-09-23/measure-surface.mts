/**
 * 一次性装配账读数（模型面固定成本）。不属于判卷文件，可删。
 * 跑法：TERM=dumb node --import tsx tmp/measure-model-surface.mts
 */
import { readFileSync } from "node:fs";
import { sessionToolSpecs } from "../src/agent/glm-session";
import { rankToolSpecs } from "../src/agent/gym/probe";

const utf8 = (s: string) => Buffer.byteLength(s, "utf8");

/* BASE_SYSTEM 从源码里取（避开 import agent-runner 拉起 electron 的整块依赖面）。
   JS 侧匹配，不落 shell grep —— 本仓定稿。 */
const runner = readFileSync("src/main/agent-runner.ts", "utf8");
const m = /export const BASE_SYSTEM = \[([\s\S]*?)\]\.join\(/.exec(runner);
if (!m) throw new Error("BASE_SYSTEM 形状变了，读数脚本要跟着改");
/* 本仓自己的源码字面量，按 JS 字符串求值 —— 手写转义解析会把读数算错。 */
const baseSystem: string = (new Function("return [" + m[1] + "].join('\\n');"))();

const baseBytes = utf8(baseSystem);
console.log(`BASE_SYSTEM: ${baseBytes} B (${baseSystem.length} chars)`);

/* 静态 13 条 */
const stat = sessionToolSpecs({ mode: "default" });
const statBytes = utf8(JSON.stringify(stat.specs));
console.log(`静态工具面: ${stat.specs.length} 条 / ${statBytes} B`);
for (const r of rankToolSpecs(stat.specs)) console.log(`  ${r.name.padEnd(18)} ${r.bytes} B`);
console.log(`=> 每请求固定面（静态）: ${baseBytes + statBytes} B，工具占 ${((statBytes / (baseBytes + statBytes)) * 100).toFixed(1)}%`);

/* MCP 追加：三种真实形态，量「无总闸」的斜率 */
const mkTools = (n: number, descLen: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `mcp__srv__tool_${i}`,
    description: "x".repeat(descLen),
    parameters: { type: "object", properties: { a: { type: "string", description: "y".repeat(120) } } },
    grade: "read" as const,
  }));
for (const [label, n, d] of [
  ["单 server 25 工具（中描述）", 25, 300],
  ["三 server 各 20 工具（中描述）", 60, 300],
  ["话痨 server 20 工具（顶格 2KB 描述）", 20, 2048],
  ["极端：四话痨 server 80 工具", 80, 2048],
] as const) {
  const r = sessionToolSpecs({ mode: "default", pluginTools: mkTools(n, d) as never });
  const bytes = utf8(JSON.stringify(r.specs));
  console.log(
    `MCP ${label}: +${r.specs.length - stat.specs.length} 条 ⇒ 工具面 ${bytes} B（${((bytes / statBytes - 1) * 100).toFixed(0)}% ↑）｜固定面 ${baseBytes + bytes} B`,
  );
}

/* 缓存命中份额（可复跑读数） */
import { readdirSync } from "node:fs";
import { join } from "node:path";
let hit = 0,
  inp = 0,
  rows = 0;
for (const dir of readdirSync("outputs").filter((d) => d.startsWith("loop-eval-"))) {
  for (const f of readdirSync(join("outputs", dir)).filter((x) => x.endsWith(".events.jsonl"))) {
    for (const line of readFileSync(join("outputs", dir, f), "utf8").split("\n")) {
      if (!line.includes('"usage"')) continue;
      try {
        const e = JSON.parse(line);
        const u = e.usage ?? e.data?.usage;
        if (!u) continue;
        const it = u.inputTokens ?? u.input_tokens ?? 0;
        const cr = u.cacheReadInputTokens ?? u.cache_read_input_tokens ?? u.cacheRead ?? 0;
        if (it) {
          inp += it;
          hit += cr;
          rows++;
        }
      } catch {
        /* 逐行容错 */
      }
    }
  }
}
console.log(`实跑 usage: ${rows} 条，cacheRead/input = ${hit}/${inp} = ${inp ? ((hit / inp) * 100).toFixed(1) : "n/a"}%`);
