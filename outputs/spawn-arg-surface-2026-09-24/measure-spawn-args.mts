// 复跑面：真轨迹里模型**申报过哪些这一档不读的参数**。
//
// 为什么要有这个文件（不是"再跑一次给我看"）：第 40 页那条「1/3 真 supervise 调用带着 stages」
// 是一次性 `node -e` 探出来的。要裁决的数必须先落复跑面（第 37 页 §六 的教训：探针在每个元素处
// 收口可以结构恒真），并且**判据从生产表算**——本脚本 import `spawn-surface`，
// 表改了读数跟着改；这里再抄一份键集就是第二事实源。
//
// 跑法（仓库根，零花费、只读）：
//   node --import tsx outputs/spawn-arg-surface-2026-09-24/measure-spawn-args.mts
// 退出码：0 = 拿到读数；2 = **没有尺**（找不到语料 / 语料里没有 spawn_agent 调用）——
// 后一种绝不印 0% 冒充"模型不这么写"。
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { unconsumedSpawnArgs } from "../../src/agent/spawn-surface";
import { SPAWN_MODES } from "../../src/agent/orchestrator-config";

const ROOT = process.cwd();

/** 语料 = outputs/ 下任何含 `*.events.jsonl` 的目录（不写死目录名：加一轮实验就多一处，写死即漏计）。 */
function corpusFiles(): string[] {
  const out: string[] = [];
  const base = join(ROOT, "outputs");
  if (!existsSync(base)) return out;
  for (const name of readdirSync(base)) {
    const dir = join(base, name);
    try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) if (n.endsWith(".events.jsonl")) out.push(join(dir, n));
  }
  return out;
}

type Ev = { type?: string; name?: string; args?: unknown; agent_id?: string };

const files = corpusFiles();
if (files.length === 0) {
  console.error("没有尺：outputs/ 下找不到任何 *.events.jsonl 语料（.jsonl 从来不在 git 里，干净树必然如此）");
  process.exit(2);
}

let calls = 0;
const byMode = new Map<string, number>();
const offenders: string[] = [];
for (const path of files) {
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let e: Ev;
    try { e = JSON.parse(line) as Ev; } catch { continue; } // 逐行容错：坏行不等于整份语料作废
    if (e.type !== "tool_call" || e.name !== "spawn_agent" || e.agent_id !== undefined) continue; // 只算主会话那一次派活
    let args: Record<string, unknown>;
    try {
      args = (typeof e.args === "string" ? JSON.parse(e.args) : e.args ?? {}) as Record<string, unknown>;
    } catch { continue; }
    const mode = typeof args.mode === "string" ? args.mode : "";
    calls++;
    byMode.set(mode, (byMode.get(mode) ?? 0) + 1);
    const s = unconsumedSpawnArgs(mode, args);
    const bad = [...s.dropped, ...s.unknown];
    if (bad.length > 0) offenders.push(path.replace(ROOT + "/", "") + " mode=" + mode + " 申报了不读的键：" + bad.join("、"));
  }
}

if (calls === 0) {
  console.error("没有尺：扫了 " + String(files.length) + " 份语料，一次主会话 spawn_agent 都没有 ⇒ 这个 0 不是读数");
  process.exit(2);
}

console.log("语料 " + String(files.length) + " 份 · 主会话 spawn_agent " + String(calls) + " 次");
for (const m of [...SPAWN_MODES, ...[...byMode.keys()].filter((k) => !SPAWN_MODES.includes(k))]) {
  const n = byMode.get(m) ?? 0;
  console.log("  mode=" + (m === "" ? "(缺档名)" : m) + " → " + String(n) + " 次 · " + (calls > 0 ? Math.round((n / calls) * 100) + "%" : "-"));
}
console.log("其中申报了这一档不读/不存在的键：" + String(offenders.length) + " 次");
for (const o of offenders) console.log("  " + o);
