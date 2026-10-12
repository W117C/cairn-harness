// P0 读数（只读）：从真实会话日志里量「实际被调用过的工具集」与它的集中度。
//
// 为什么这条读数值得单独量：P0 的问题是「真实工具面多大、有没有丢人」，而事件流此前不记装配账。
// 在 `surface_account` 生效之前的全部历史会话都不可能直接回答它——但**它们记了工具调用**。
// 「候选集有多大」与「实际被用到几把」是同一议题的两半：前者决定降配梯会不会开火，后者决定
// 按需披露 / 静态分面值不值得做。这一半今天就能量，而且用的是真数据，不是合成靶面。
//
// 诚实边界（读的人必须先看这一条）：
//   · 这是**使用集**，不是声明面。声明面 = 模型看得见的全部工具；使用集 ⊆ 声明面。
//     所以下面的数字是真实面的**下界**，不能当「面就这么大」用。
//   · 只算 `tool/call` 事件。被摘掉、从未被调用的工具在这份读数里不存在。
//   · 它是**历史**读数：这些会话跑在 `surface_account` 落地之前，不可能有装配账。
//   · 会话之间的「不同工具数」不可直接平均：**子代理会话**（`parentSession` 在场）通常只做一件事，
//     与主会话混在一起会把中位数拉低。下面两者分开报。
//
// 格式坑（2026-10-03 实测，写下来免得下一个人再踩；两个都踩过一次）：
//
//   ① `session.v4.jsonl.zstd` 不是**单帧** zstd，而是**一帧一次 append 的拼接流**。
//      Node 的 `zstdDecompressSync` / 流式 `createZstdDecompress` **都只解第一帧就停**
//      （实测 36,774 B 的文件只吐出 291 B —— 而且不报错，静默少读）。必须按帧魔数
//      `28 B5 2F FD`（小端 0xFD2FB528）切帧后逐帧解。切错了也不怕：解不开就把这一片
//      并进下一片重试，并把最终失败如实计数（见 `framesFailed`）。
//
//   ② **v4 会话日志的词表不是内核的词表**。`~/.dsh/sessions/**` 存的是 app 层事件
//      `{"type":"<ns/kind>","seq","time","data"}`：`tool/call` / `tool/result` /
//      `assistant/attempt` / `turn/start` ……  而 `src/events/index.ts` 的 `AgentEvent`
//      是内核词表（`tool_call` / `assistant_message` / …）。按内核词表去 grep v4 日志
//      会**一条都搜不到还零报错**——实测就是先拿了 0 命中才发现这件事的。
//
// 用法：node --import tsx outputs/tool-face-p0-readings-2026-10-03/measure-used-tools.mts [--json]
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { zstdDecompressSync } from "node:zlib";

/** 目标文件：缺省仍是本目录那份（历史行为），`--to=<path>` 另存，`--force` 才允许覆盖。
 *  为什么要这道门（2026-10-12 实测踩过一次）：本脚本从前**直写** `used-tools.json`，
 *  谁再跑一次就把 10-03 那一笔的读数静默顶掉——那正是本仓「基线不覆盖」那条规矩要防的事。 */
const TO_ARG = process.argv.find((a) => a.startsWith("--to="));
const OUT_PATH = TO_ARG !== undefined ? resolve(TO_ARG.slice("--to=".length)) : join(import.meta.dirname, "used-tools.json");
if (existsSync(OUT_PATH) && !process.argv.includes("--force")) {
  console.error("[measure-used-tools] 目标已存在，拒写：" + OUT_PATH);
  console.error("  本脚本从前直写它，会把那一笔的读数顶掉（2026-10-12 实测踩过一次）。");
  console.error("  要另存：--to=<新路径>；确实要覆盖：再加 --force。");
  process.exit(2);
}

const ROOT = join(homedir(), ".dsh", "sessions");
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

async function findLogs(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await findLogs(p, out);
    else if (e.isFile() && e.name.endsWith(".jsonl.zstd")) out.push(p);
  }
  return out;
}

/** 按帧魔数切帧后逐帧解压。切错时把这一片并进下一片重试；最终解不开的只计数、不静默。 */
function decodeAllFrames(buf: Buffer): { text: string; frames: number; framesFailed: number } {
  const starts: number[] = [];
  for (let i = buf.indexOf(ZSTD_MAGIC); i >= 0; i = buf.indexOf(ZSTD_MAGIC, i + 4)) starts.push(i);
  if (starts.length === 0) {
    // 没有魔数：要么空文件，要么根本不是 zstd。后者要出声。
    return { text: "", frames: 0, framesFailed: buf.length > 0 ? 1 : 0 };
  }
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
      // 这片不是帧边界（魔数撞进了压缩数据里）：并进下一片再试。
      if (k + 1 < starts.length) {
        starts[k + 1] = starts[k]!; // 把下一片的起点前移，等价于「合并两片」
        k++;
      } else {
        framesFailed++;
        k++;
      }
    }
  }
  return { text: parts.join(""), frames, framesFailed };
}

interface SessionReading {
  path: string;
  bytes: number;
  frames: number;
  framesFailed: number;
  /** 子代理会话（链式派生的那一份）：它的「用了几把工具」与主会话不可同口径平均。 */
  isSubagent: boolean;
  toolCalls: number;
  calls: Map<string, number>;
  error: string | null;
}

async function readOne(path: string): Promise<SessionReading> {
  const info = await stat(path);
  let text = "";
  let frames = 0;
  let framesFailed = 0;
  let error: string | null = null;
  try {
    const decoded = decodeAllFrames(await readFile(path));
    text = decoded.text;
    frames = decoded.frames;
    framesFailed = decoded.framesFailed;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (framesFailed > 0) error ??= framesFailed + " 帧解不开（只覆盖读到的部分）";

  const lines = text.split("\n");
  // 首行是会话头；`parentSession` 在场 = 子代理会话。
  let isSubagent = false;
  try {
    const head = JSON.parse(lines[0] ?? "{}") as { parentSession?: unknown };
    isSubagent = typeof head.parentSession === "string" && head.parentSession.length > 0;
  } catch {
    // 头解析失败就当主会话——**但这不是「确定是主会话」**，只是不在这里另造静默通道；
    // 真正的坏帧由 framesFailed / error 那条线点名。
  }

  const calls = new Map<string, number>();
  let toolCalls = 0;
  for (const line of lines) {
    // v4 词表：`{"type":"tool/call","seq":…,"data":{"turn","step","callId","name","arguments"}}`。
    // 名字在 `data.name`，不在顶层——顶层那个 `type` 是事件种类。
    if (!line.includes('"type":"tool/call"')) continue;
    try {
      const ev = JSON.parse(line) as { data?: { name?: unknown } };
      const name = ev.data?.name;
      if (typeof name !== "string" || name.length === 0) continue;
      toolCalls++;
      calls.set(name, (calls.get(name) ?? 0) + 1);
    } catch {
      // 坏行跳过，不在这里另造静默通道（坏帧已由 framesFailed 点名）。
    }
  }
  return { path, bytes: info.size, frames, framesFailed, isSubagent, toolCalls, calls, error };
}

const median = (xs: number[]): number =>
  xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const logs = await findLogs(ROOT);
  const readings: SessionReading[] = [];
  const unreadable: { path: string; error: string }[] = [];
  for (const p of logs) {
    try {
      readings.push(await readOne(p));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      unreadable.push({ path: p, error: msg });
      console.error("[读不开] " + p + " —— " + msg);
    }
  }
  // 读了一半的：计数照旧，但必须点名——否则「少读了几个工具」会伪装成「这些工具没被用过」。
  const partial = readings.filter((r) => r.error !== null);

  interface ToolRow { name: string; calls: number; sessions: number; subagentSessions: number }
  const byTool = new Map<string, ToolRow>();
  for (const r of readings) {
    for (const [name, calls] of r.calls) {
      const row = byTool.get(name) ?? { name, calls: 0, sessions: 0, subagentSessions: 0 };
      row.calls += calls;
      row.sessions++;
      if (r.isSubagent) row.subagentSessions++;
      byTool.set(name, row);
    }
  }
  const tools = [...byTool.values()].sort((a, b) => b.calls - a.calls);
  const totalCalls = readings.reduce((s, r) => s + r.toolCalls, 0);

  // 集中度：把工具按调用量降序累加，看几名覆盖到 50/80/90/100%。
  let acc = 0;
  const share: Record<string, number> = {};
  for (let i = 0; i < tools.length; i++) {
    acc += tools[i]!.calls;
    const pct = totalCalls === 0 ? 0 : (100 * acc) / totalCalls;
    for (const mark of [50, 80, 90, 100]) {
      if (pct >= mark && share[String(mark)] === undefined) share[String(mark)] = i + 1;
    }
  }
  // 「只用过 N 把」的分布：这些会话里，多少次工具调用能靠前 N 把工具覆盖完。
  const coverFor = (n: number): number => {
    const covered = tools.slice(0, n).reduce((s, t) => s + t.calls, 0);
    return totalCalls === 0 ? 0 : (100 * covered) / totalCalls;
  };

  const mainSessions = readings.filter((r) => !r.isSubagent && r.toolCalls > 0);
  const subSessions = readings.filter((r) => r.isSubagent && r.toolCalls > 0);

  const report = {
    root: ROOT,
    sessions: readings.length,
    sessionsUnreadable: unreadable,
    sessionsPartial: partial.map((p) => ({ path: p.path, bytes: p.bytes, error: p.error })),
    framesTotal: readings.reduce((s, r) => s + r.frames, 0),
    framesFailedTotal: readings.reduce((s, r) => s + r.framesFailed, 0),
    sessionsWithToolCalls: readings.filter((r) => r.toolCalls > 0).length,
    sessionsMain: mainSessions.length,
    sessionsSubagent: subSessions.length,
    totalToolCalls: totalCalls,
    distinctToolsEverUsed: tools.length,
    perSessionDistinct: {
      allMedian: median(readings.filter((r) => r.toolCalls > 0).map((r) => r.calls.size)),
      mainMin: mainSessions.length ? Math.min(...mainSessions.map((r) => r.calls.size)) : 0,
      mainMedian: median(mainSessions.map((r) => r.calls.size)),
      mainMax: mainSessions.length ? Math.max(...mainSessions.map((r) => r.calls.size)) : 0,
      subagentMedian: median(subSessions.map((r) => r.calls.size)),
    },
    concentration: share,
    coverage: { top5: coverFor(5), top10: coverFor(10), top20: coverFor(20), top30: coverFor(30) },
    tools: tools.map((t) => ({ ...t })),
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("== P0 读数：真实会话里实际被调用过的工具集 ==");
  console.log("取料：" + ROOT);
  console.log("口径：**使用集是声明面的下界**，不是声明面本身；只算 tool/call。见本文件头注。");
  console.log("");
  console.log("  会话日志          " + report.sessions + " 份（有工具调用 " + report.sessionsWithToolCalls
    + "：主会话 " + report.sessionsMain + " / 子代理 " + report.sessionsSubagent + "）");
  console.log("  zstd 帧           " + report.framesTotal + "（解不开 " + report.framesFailedTotal + "）");
  if (unreadable.length > 0) console.log("  读不开            " + unreadable.length + " 份");
  if (partial.length > 0) console.log("  **只读了一半**    " + partial.length + " 份（坏帧中断 ⇒ 这些会话是下界中的下界）");
  console.log("  工具调用总数      " + report.totalToolCalls);
  console.log("  **用过的不同工具**  " + report.distinctToolsEverUsed + " 把");
  console.log("");
  console.log("  单会话用到的不同工具数：");
  console.log("      主会话   min " + report.perSessionDistinct.mainMin
    + " / 中位 " + report.perSessionDistinct.mainMedian
    + " / max " + report.perSessionDistinct.mainMax);
  console.log("      子代理   中位 " + report.perSessionDistinct.subagentMedian);
  console.log("");
  console.log("  集中度（按调用量降序，前 N 把覆盖多少调用）：");
  console.log("      前 5 把 " + report.coverage.top5.toFixed(1) + "%"
    + "    前 10 把 " + report.coverage.top10.toFixed(1) + "%"
    + "    前 20 把 " + report.coverage.top20.toFixed(1) + "%"
    + "    前 30 把 " + report.coverage.top30.toFixed(1) + "%");
  console.log("      覆盖到 50% 需要 " + String(report.concentration["50"]) + " 把"
    + "；80% 需要 " + String(report.concentration["80"]) + " 把"
    + "；90% 需要 " + String(report.concentration["90"]) + " 把");
  console.log("");
  console.log("  逐把明细（前 30）：");
  console.log("      " + "工具".padEnd(30) + "调用数".padStart(8) + "会话数".padStart(8) + "其中子代理".padStart(11));
  for (const t of tools.slice(0, 30)) {
    console.log("      " + t.name.padEnd(30) + String(t.calls).padStart(8)
      + String(t.sessions).padStart(8) + String(t.subagentSessions).padStart(11));
  }
  if (tools.length > 30) console.log("      …另有 " + (tools.length - 30) + " 把在长尾里");

  await writeFile(
    OUT_PATH,
    JSON.stringify({ ...report, tools }, null, 2) + "\n",
    "utf8",
  );
  console.log("");
  console.log("  明细已写：" + OUT_PATH);
}

await main();
