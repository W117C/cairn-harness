// M6 验收读数之一：对仓库里 tracked 的会话日志做**离线提炼**（不调模型、不写盘）。
// 跑法：`node --import tsx scripts/replay/lessons-offline.ts [日志…]`
// 默认目标是 `git ls-files 'outputs/**/*.jsonl'` 的那批。
//
// 取料层复用共用的那个（`corpus.ts`）——它管"去哪儿拿语料"，本面只管"拿到的日志问什么"，
// 两件事分开。共用取料层按设计不入复跑面登记表，被已登记的面 import 即可（见 replay-readings.ts）。
//
// 本面**只 print、不 assert**（读数面，不是判卷面）：一条数都不判，判它的那把尺在
// `tests/replay-faces.test.ts`（真 spawn 本面，钉 exit 0 与关键行在不在）。
//
// 2026-10-07 起多印一节「复发读数」（`scripts/replay/lessons-recurrence.ts`）：教训**落盘之后**
// 同类失败还复不复发。那节的排序时间取**该会话最后一个事件的 `ts`**（会话收束时刻，教训正是
// 那一刻落盘的），老日志没有 `ts` 则退到文件 mtime；理由与口径写在新模块文件头，别在这里再写一份。
import { readFile, stat } from "node:fs/promises";
import { scanCorpus, corpusRoots } from "./corpus";
import { distillLessons, VERIFY_TOOL_NAME } from "../../src/agent/memory/lessons";
import { census, recurrence, RECURRENCE_CALIBER, type SessionFacts } from "./lessons-recurrence";
import type { AgentEvent } from "../../src/events";

/** 语料：共用的扫描层把两个根都扫了（仓库内 outputs/ ＋ 本机真会话目录）。
 *  真会话那一根在别人机器上不存在，`missingRoots` 会自己说出来——零语料不静默。 */
function defaultPaths(): string[] {
  const scan = scanCorpus(corpusRoots());
  if (scan.missingRoots.length > 0) {
    console.log("[lessons-offline] ⚠️ 缺失的语料根（本机没这些目录，那一支零语料，不是错误）：" + scan.missingRoots.join("、"));
  }
  return scan.files;
}

async function load(path: string): Promise<{ events: AgentEvent[]; bad: number }> {
  const raw = await readFile(path, "utf8");
  const events: AgentEvent[] = [];
  let bad = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      events.push(JSON.parse(line) as AgentEvent);
    } catch {
      bad += 1;
    }
  }
  return { events, bad };
}

/** 会话时间：该会话**最后一个**带 `ts` 的事件（收束时刻）；一个都没有 ⇒ null（调用方退到 mtime）。 */
function lastEventTs(events: AgentEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const t = events[i]!.ts;
    if (typeof t === "number") return t;
  }
  return null;
}

const paths = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultPaths();
let totalLessons = 0;
let filesWithLessons = 0;
const byKind: Record<string, number> = {};
const sessions: SessionFacts[] = [];
const orphanTotals = { codeRed: 0, envRed: 0, toolFail: 0, orphanFail: 0, verifyBeats: 0 };
console.log("[lessons-offline] 日志数 = " + String(paths.length));
for (const p of paths) {
  const { events, bad } = await load(p);
  const st = await stat(p).catch(() => null);
  sessions.push({ id: p, time: lastEventTs(events) ?? st?.mtimeMs ?? 0, events });
  const c = census(events);
  orphanTotals.codeRed += c.codeRed;
  orphanTotals.envRed += c.envRed;
  orphanTotals.toolFail += c.toolFail;
  orphanTotals.orphanFail += c.orphanFail;
  orphanTotals.verifyBeats += c.verifyBeats;
  const lessons = distillLessons(events, p);
  totalLessons += lessons.length;
  if (lessons.length > 0) filesWithLessons += 1;
  for (const l of lessons) {
    const k = l.evidence[0]!.kind;
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  console.log(
    "  " + p.padEnd(58) +
    " events=" + String(events.length).padStart(5) +
    " 坏行=" + String(bad).padStart(2) +
    " verify拍=" + String(c.verifyBeats).padStart(3) +
    " 代码红=" + String(c.codeRed).padStart(3) +
    " 环境红=" + String(c.envRed).padStart(3) +
    " 工具红=" + String(c.toolFail).padStart(3) +
    " 无归属红=" + String(c.orphanFail).padStart(3) +
    " ⇒ 教训=" + String(lessons.length),
  );
  for (const l of lessons) {
    console.log("      · [" + l.evidence[0]!.kind + "] " + l.topic + " ← " + l.evidence[0]!.session + "#" + l.evidence[0]!.callId);
  }
}
console.log("[lessons-offline] 合计：产出教训 " + String(totalLessons) + " 条，覆盖 " + String(filesWithLessons) + "/" + String(paths.length) + " 份日志");
console.log("[lessons-offline] 按类：" + JSON.stringify(byKind));
console.log("[lessons-offline] 分母侧（不依赖提炼器）：" + JSON.stringify(orphanTotals));
console.log("[lessons-offline] verify 工具名常量 = " + JSON.stringify(VERIFY_TOOL_NAME));
console.log("[lessons-offline] 说明：'无归属红' 是 tool_result 查不到 tool_call 的那些——它们**不**进教训（无证据指针），");
console.log("[lessons-offline]       这一列的数就是硬门真在拦的量，不是 bug。");

// ---- 复发读数（教训落盘之后，同类失败还复不复发）----
// 纯读数：只说数与率，一句因果都不下（口径见 lessons-recurrence.ts 的 RECURRENCE_CALIBER）。
const reading = recurrence(sessions);
const pct = (r: number | null): string => (r === null ? "—（分母 0，不是 0%）" : (r * 100).toFixed(1) + "%");
console.log("[lessons-offline] ----");
console.log("[lessons-offline] 复发读数：教训「已可用」与同类失败「仍复发」的相关性（折演与口径见 scripts/replay/lessons-recurrence.ts）");
console.log("[lessons-offline] 排序键 = 会话内最后一个事件的 ts（收束时刻），无 ts 的老日志退到文件 mtime；两项都是毫秒纪元，可混排");
if (reading.sessions === 0) {
  console.log("[lessons-offline] ⚠️ 零语料：一场会话都没有 ⇒ 这不是「复发率 0」，是**没有尺**（换到有语料的树上再跑）。");
} else {
  for (const r of reading.rows) {
    console.log("[lessons-offline]   " + r.kind.padEnd(14)
      + " 已可用组 " + String(r.available.recurred) + "/" + String(r.available.sessions) + " (" + pct(r.available.rate) + ")"
      + "　尚不可用组 " + String(r.unavailable.recurred) + "/" + String(r.unavailable.sessions) + " (" + pct(r.unavailable.rate) + ")");
  }
  console.log("[lessons-offline] 功效：两组分母 "
    + reading.rows.map((r) => r.kind + "=" + String(r.available.sessions) + "/" + String(r.unavailable.sessions)).join("、")
    + " ⇒ 这个量级读不出任何显著差异；本读数不报显著性，「一个正确的零」是合格结果。");
}
console.log("[lessons-offline] 口径：" + RECURRENCE_CALIBER);
console.log("[lessons-offline]       「已可用组」= 该场之前已有别的会话产出过该类教训；「本场复发/出现」由分母侧那一族的口径判");
console.log("[lessons-offline]       （verify-red ⟸ 代码红>0；tool-streak ⟸ 工具红>0；repeat-action 例外——census 无此列，退用提炼器自身产出，见模块头）。");
