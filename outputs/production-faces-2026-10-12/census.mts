// 生产语料普查（只读）：盘上到底有没有**本仓自己的**生产会话？某一格能不能量？
//
// 为什么值得一次单独的读数：`docs/m5-acceptance.md` 有三格写着「未测量」，其中一格
// （「所有生产 spawn 都留 `routing_decision`」）一直被读成"再跑跑就有了"。本脚本量的是
// **这个前提本身**：那批会话记的是哪一层的词表、有没有本仓内核的事件。
//
// 两处必须写下来的坑（都是实测踩过的）：
//  ① `session.v4.jsonl.zstd` 不是单帧，而是**一帧一次 append 的拼接流**；Node 的
//     `zstdDecompressSync` 只解第一帧就停且不报错 ⇒ 必须按帧魔数切帧。三份同类脚本
//     （`outputs/tool-face-p0-readings-2026-10-03/*.mts`）各自带一份同样切法——本脚本是第四份。
//     ponytail: 第四份副本；要收就抽成 `scripts/lib/session-log.ts` 并让四份迁移，别零散改。
//  ② **子串计数是假读数**：`routing_decision`／`agent_spawned` 在语料里确实"出现"，但全在
//     正文里（checkpoint 摘要、diff、模型自述）。按 `e.type` 结构化数一次才知道是 0。
//     本脚本同时印两个数，就是为了让这个陷阱当场可见。
//
// 用法：node --import tsx outputs/production-faces-2026-10-12/census.mts
// 退出码：0＝语料里没有本仓内核 spawn 事件（预期，见 census.json）；1＝出现了（该更新结论了）。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const ROOT = join(homedir(), ".dsh", "sessions");
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const KERNEL = new Set(["agent_spawned", "routing_decision"]);

/** 按帧魔数切帧后逐帧解压；魔数撞进压缩数据时把这一片并进下一片重试，最终解不开的只计数。 */
function decodeAllFrames(buf: Buffer): { text: string; frames: number; framesFailed: number } {
  const starts: number[] = [];
  for (let i = buf.indexOf(MAGIC); i >= 0; i = buf.indexOf(MAGIC, i + 4)) starts.push(i);
  if (starts.length === 0) return { text: "", frames: 0, framesFailed: buf.length > 0 ? 1 : 0 };
  const parts: string[] = [];
  let frames = 0;
  let framesFailed = 0;
  let k = 0;
  while (k < starts.length) {
    const end = k + 1 < starts.length ? starts[k + 1]! : buf.length;
    try {
      parts.push(zstdDecompressSync(buf.subarray(starts[k]!, end)).toString("utf8"));
      frames++;
      k++;
    } catch {
      if (k + 1 < starts.length) {
        starts[k + 1] = starts[k]!;
        k++;
      } else {
        framesFailed++;
        k++;
      }
    }
  }
  return { text: parts.join(""), frames, framesFailed };
}

const files: string[] = [];
let workspaces = 0;
for (const ws of readdirSync(ROOT)) {
  let subs: string[] = [];
  try {
    subs = readdirSync(join(ROOT, ws));
  } catch {
    continue;
  }
  workspaces++;
  for (const d of subs) {
    try {
      for (const f of readdirSync(join(ROOT, ws, d))) if (f.endsWith(".zstd")) files.push(join(ROOT, ws, d, f));
    } catch {
      /* 不是会话目录（或没权限）：跳过 */
    }
  }
}

const types = new Map<string, number>();
let lines = 0;
let parseFailed = 0;
let framesFailed = 0;
let structured = 0; // 按 e.type 数：本仓内核 spawn 事件
let substring = 0; // 按子串数：正文里提到这两个词的也算 —— 假读数那一档
for (const f of files) {
  const dec = decodeAllFrames(readFileSync(f));
  framesFailed += dec.framesFailed;
  for (const ln of dec.text.split("\n")) {
    if (!ln.trim()) continue;
    lines++;
    if (/routing_decision|agent_spawned/.test(ln)) substring++;
    let e: { type?: unknown };
    try {
      e = JSON.parse(ln) as { type?: unknown };
    } catch {
      parseFailed++;
      continue;
    }
    if (typeof e.type === "string") {
      types.set(e.type, (types.get(e.type) ?? 0) + 1);
      if (KERNEL.has(e.type)) structured++;
    }
  }
}

const report = {
  corpusRoot: ROOT,
  workspaces,
  sessions: files.length,
  lines,
  parseFailed,
  framesFailed,
  eventTypes: types.size,
  kernelSpawnEventsStructured: structured,
  kernelWordsInProseSubstring: substring,
};
console.log(JSON.stringify(report, null, 2));
console.log("\n按 e.type 数到 0 而按子串数到 " + String(substring) +
  " ⇒ 那两个词只出现在正文里，不构成事件（第 443 页那张账记的就是这件事）。");
writeFileSync(join(import.meta.dirname, "census.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
if (structured > 0) {
  console.error("\n⚠️ 语料里出现了 " + String(structured) +
    " 条本仓内核 spawn 事件 ⇒ 「生产样本=0」这个结论要重估，别照抄旧页。");
  process.exit(1);
}
