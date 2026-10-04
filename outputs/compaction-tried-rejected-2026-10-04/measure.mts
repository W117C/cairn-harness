/** 「Tried & Rejected」这一段在真语料上有多长？会不会把摘要顶过 `summaryCapTokens`？
 *  取料＝git 跟踪的 .jsonl 语料（按关系取，不按关键词猜）；尺＝被测模块自己导出的那两个函数，不重抄逻辑。
 *  分母自己出声：读到 0 个文件就抛，不许把"没取到料"读成"没有失败"。 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_COMPACTION_CONFIG,
  TRIED_REJECTED_CAPS,
  extractTriedRejected,
  triedRejectedNote,
} from "../../src/agent/compaction";

const ROOT = process.cwd();
const tracked = execFileSync("git", ["ls-files", "-z", "--", "fixtures"], { cwd: ROOT, encoding: "utf8" })
  .split("\0").filter((p) => p.endsWith(".jsonl")).sort();

const eventsOf = (rel: string): Record<string, unknown>[] =>
  readFileSync(join(ROOT, rel), "utf8").split("\n").filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

interface Row { file: string; events: number; failures: number; bullets: number; sectionChars: number; summaryChars: number | null }
const rows: Row[] = [];
const badParse: string[] = [];

for (const rel of tracked) {
  let evs: Record<string, unknown>[];
  try { evs = eventsOf(rel); } catch { badParse.push(rel); continue; }
  const typed = evs as unknown as Parameters<typeof extractTriedRejected>[0];
  const bullets = extractTriedRejected(typed);
  const compaction = evs.filter((e) => e.type === "compaction");
  rows.push({
    file: rel,
    events: evs.length,
    failures: evs.filter((e) =>
      (e.type === "tool_result" && e.ok === false) ||
      (e.type === "verify_result" && e.ok === false) ||
      (e.type === "plan_approved" && e.approved === false)).length,
    bullets: bullets.length,
    sectionChars: triedRejectedNote(typed).length,
    summaryChars: compaction.length === 0 ? null
      : Math.max(...compaction.map((e) => String((e as { summary?: string }).summary ?? "").length)),
  });
}

if (rows.length < 30) throw new Error("取料面只读到 " + String(rows.length) + " 个语料文件 ⇒ 没有尺，别把空读当成通过");
const stat = (pick: (r: Row) => number): { max: number; med: number; sum: number } => {
  const v = rows.map(pick).sort((a, b) => a - b);
  return { max: v[v.length - 1] ?? 0, med: v[Math.floor(v.length / 2)] ?? 0, sum: v.reduce((a, b) => a + b, 0) };
};
const withNote = rows.filter((r) => r.sectionChars > 0);
const sc = stat((r) => r.sectionChars);
const bl = stat((r) => r.bullets);
const capTokens = DEFAULT_COMPACTION_CONFIG.summaryCapTokens;
// 粗估只为看量级；真正判超帽的是闸内的 estimateTokens（这里不冒充它）。
const roughTokens = (chars: number): number => Math.round(chars / 2);

console.log("帽现读：bullets=" + String(TRIED_REJECTED_CAPS.bullets) + " lineChars=" + String(TRIED_REJECTED_CAPS.lineChars) + " summaryCapTokens=" + String(capTokens));
console.log("语料文件=" + String(rows.length) + "｜解析失败=" + String(badParse.length) + "｜会插入那一段的=" + String(withNote.length) + "｜零失败（一段都不插）的=" + String(rows.length - withNote.length));
console.log("段长：max=" + String(sc.max) + " 中位=" + String(sc.med) + " 合计=" + String(sc.sum));
console.log("条目数：max=" + String(bl.max) + " 中位=" + String(bl.med) + "｜撞到条数帽的文件=" + String(rows.filter((r) => r.bullets >= TRIED_REJECTED_CAPS.bullets).length));
console.log("与既有摘要同框：同文件 compaction 摘要字符 max=" + String(Math.max(0, ...rows.map((r) => r.summaryChars ?? 0))) +
  "｜粗估（段长＋既有摘要）越过帽的文件数=" + String(rows.filter((r) => roughTokens(r.sectionChars + (r.summaryChars ?? 0)) > capTokens).length));
for (const t of [...withNote].sort((a, b) => b.sectionChars - a.sectionChars).slice(0, 3)) {
  console.log("最长样本：" + t.file + " 事件=" + String(t.events) + " 失败面=" + String(t.failures) + " 条目=" + String(t.bullets) + " 段长=" + String(t.sectionChars) + " 既有摘要=" + String(t.summaryChars ?? "无"));
}
if (withNote[0]) {
  console.log("--- 逐字样例（" + withNote[0].file + "）---");
  console.log(triedRejectedNote(eventsOf(withNote[0].file) as unknown as Parameters<typeof triedRejectedNote>[0]).slice(0, 900));
}
