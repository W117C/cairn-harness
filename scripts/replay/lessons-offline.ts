// M6 验收读数之一：对仓库里 tracked 的会话日志做**离线提炼**（不调模型、不写盘）。
// 跑法：`node --import tsx scripts/replay/lessons-offline.ts [日志…]`
// 默认目标是 `git ls-files 'outputs/**/*.jsonl'` 的那批。
//
// 取料层复用共用的那个（`corpus.ts`）——它管"去哪儿拿语料"，本面只管"拿到的日志问什么"，
// 两件事分开。共用取料层按设计不入复跑面登记表，被已登记的面 import 即可（见 replay-readings.ts）。
import { readFile } from "node:fs/promises";
import { scanCorpus, corpusRoots } from "./corpus";
import { distillLessons, VERIFY_TOOL_NAME } from "../../src/agent/memory/lessons";
import { isEnvVerifyCause, type AgentEvent, type ToolResultEvent, type VerifyResultEvent } from "../../src/events";

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

/** 分母侧计数：与提炼口径分开算，好让读数里「有多少红」不必依赖提炼器没漏。 */
function census(events: AgentEvent[]): { codeRed: number; envRed: number; toolFail: number; orphanFail: number; verifyBeats: number } {
  const names = new Map<string, string>();
  const verifyIds = new Set<string>();
  for (const e of events) {
    if (e.type === "tool_call") names.set(e.id, e.name);
    if (e.type === "verify_result") { verifyIds.add(e.callId); }
  }
  let codeRed = 0;
  let envRed = 0;
  let verifyBeats = 0;
  for (const e of events) {
    if (e.type !== "verify_result") continue;
    verifyBeats += 1;
    if (e.ok) continue;
    if (isEnvVerifyCause(e.cause)) envRed += 1;
    else codeRed += 1;
  }
  let toolFail = 0;
  let orphanFail = 0;
  for (const e of events as ToolResultEvent[]) {
    if (e.type !== "tool_result" || e.ok) continue;
    if (verifyIds.has(e.callId)) continue;
    if (e.blockedBy !== undefined) continue;
    if (names.get(e.callId) === undefined) orphanFail += 1;
    else toolFail += 1;
  }
  return { codeRed, envRed, toolFail, orphanFail, verifyBeats };
}

const paths = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultPaths();
let totalLessons = 0;
let filesWithLessons = 0;
const byKind: Record<string, number> = {};
const orphanTotals = { codeRed: 0, envRed: 0, toolFail: 0, orphanFail: 0, verifyBeats: 0 };
console.log("[lessons-offline] 日志数 = " + String(paths.length));
for (const p of paths) {
  const { events, bad } = await load(p);
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
