/** #66 的暴露面与成本上界：翻默认之前，先算清「返修那一轮会碰到多少趟、最坏多花什么」。
 *  取料＝本机留档 outputs/<dated>/readings.json 里**所有** `{r,g}` 趟次（按关系取，不按某一支新键名取——
 *  第一版我就是那么取的，结果 29 份文件只认得 13 趟，把"取料窄"读成了"没有返修机会"）。
 *  schema 漂移要逐格印：老趟次没有 verifyRecovery／model，那一格只能报"这一格无从判"，不许当 false。 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const files: string[] = [];
const walk = (d: string, depth: number): void => {
  if (depth > 2) return;
  let names: string[];
  try { names = readdirSync(d); } catch { return; }
  for (const n of names) {
    const p = join(d, n);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth + 1);
    else if (n === "readings.json") files.push(p);
  }
};
walk("outputs", 0);

interface Run {
  file: string; id: string; system: string; model: string | null;
  requests: number; tokensOut: number; tokensIn: number; seconds: number; cny: number | null;
  autoVerifyBeat: boolean | null; verifyOkLast: boolean | null; verified: number | null;
  recovery: string | null; wroteCode: boolean | null;
}
const runs: Run[] = [];
const fieldFace = new Map<string, { have: number; miss: number }>();
const noteField = (name: string, present: boolean): void => {
  const g = fieldFace.get(name) ?? { have: 0, miss: 0 };
  if (present) g.have += 1; else g.miss += 1;
  fieldFace.set(name, g);
};

for (const f of files) {
  let j: unknown;
  try { j = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
  const arr = Array.isArray(j) ? j : Object.values(j as Record<string, unknown>);
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const wrap = item as { r?: Record<string, unknown> };
    const rec = wrap.r ?? (item as Record<string, unknown>);
    if (!rec || typeof rec !== "object" || !("requests" in rec)) continue;   // 不是趟次行
    noteField("autoVerifyBeat", "autoVerifyBeat" in rec);
    noteField("verifyOkLast", "verifyOkLast" in rec);
    noteField("verifyRecovery", "verifyRecovery" in rec);
    noteField("model", "model" in rec);
    noteField("cny", "cny" in rec);
    noteField("changedFiles", "changedFiles" in rec);
    runs.push({
      file: f.split("/")[1] ?? f,
      id: String(rec.id ?? "?"),
      system: String(rec.system ?? "?"),
      model: "model" in rec ? String(rec.model) : null,
      requests: Number(rec.requests ?? 0),
      tokensOut: Number(rec.tokensOut ?? 0),
      tokensIn: Number(rec.tokensIn ?? 0),
      seconds: Number(rec.seconds ?? 0),
      cny: typeof rec.cny === "number" ? rec.cny : null,
      autoVerifyBeat: "autoVerifyBeat" in rec ? Boolean(rec.autoVerifyBeat) : null,
      verifyOkLast: "verifyOkLast" in rec ? Boolean(rec.verifyOkLast) : null,
      verified: "verified" in rec ? Number(rec.verified) : null,
      recovery: "verifyRecovery" in rec ? String(rec.verifyRecovery) : null,
      wroteCode: Array.isArray(rec.changedFiles) ? (rec.changedFiles as unknown[]).length > 0 : null,
    });
  }
}

if (runs.length < 40) console.log("⚠️ 只读到 " + String(runs.length) + " 趟 ⇒ 取料面比「49 趟」那张表窄，下面的分母请照此读");
console.log("留档文件=" + String(files.length) + " 份｜趟次行=" + String(runs.length));
console.log("字段可用面（有／无）：" + [...fieldFace.entries()].map(([k, v]) => k + " " + String(v.have) + "/" + String(v.miss)).join("｜"));
console.log("对照臂跑过没有：autoVerifyRepair 出现 0 次 ⇒ 净收益无据，本表只给暴露面与成本上界（哨兵：这句是我 grep 来的，不是推的）");

const noField = runs.filter((r) => r.verifyOkLast === null).length;
const measurable = runs.filter((r) => r.verifyOkLast !== null);
const endedRed = measurable.filter((r) => r.verifyOkLast === false);
const endedRedWrote = endedRed.filter((r) => r.wroteCode === true);
const wroteUnknown = endedRed.filter((r) => r.wroteCode === null).length;
const autoBeatSeen = runs.filter((r) => r.autoVerifyBeat === true).length;
const recoveryRed = runs.filter((r) => r.recovery !== null && r.recovery !== "greenFirst" && r.recovery !== "noVerify").length;

console.log("—— 暴露面（翻默认才会碰到的那一档）——");
console.log("有 verifyOkLast 的趟=" + String(measurable.length) + "（另 " + String(noField) + " 趟这一格无从判，不计入分子也不计入分母）");
console.log("结束时仍是红的趟=" + String(endedRed.length) + "（占比 " + String(Math.round((endedRed.length / Math.max(1, measurable.length)) * 100)) + "%）｜其中确认写过盘的=" + String(endedRedWrote.length) + "、changedFiles 格不存在的=" + String(wroteUnknown));
console.log("见过 harness 自动拍（autoVerifyBeat=true）的趟=" + String(autoBeatSeen));
console.log("新 schema 里「红过」的趟（verifyRecovery ≠ 一次就绿／没跑过）=" + String(recoveryRed));

const sum = (pick: (r: Run) => number): number => runs.reduce((a, r) => a + pick(r), 0);
const avg = (pick: (r: Run) => number): number => sum(pick) / Math.max(1, runs.length);
const cnyRuns = runs.filter((r) => r.cny !== null);
console.log("—— 成本上界 ——");
console.log("每趟均值：请求=" + avg((r) => r.requests).toFixed(2) + " 输入 token=" + avg((r) => r.tokensIn).toFixed(0) +
  " 输出 token=" + avg((r) => r.tokensOut).toFixed(0) + " 墙钟=" + avg((r) => r.seconds).toFixed(1) + "s");
if (cnyRuns.length > 0) {
  const avgCny = cnyRuns.reduce((a, r) => a + (r.cny ?? 0), 0) / cnyRuns.length;
  const avgReq = cnyRuns.reduce((a, r) => a + r.requests, 0) / cnyRuns.length;
  const perRound = avgCny / Math.max(1, avgReq);
  console.log("单价可读的趟=" + String(cnyRuns.length) + "（其余 cny=null ⇒ 单价未知）｜每趟均值 ¥" + avgCny.toFixed(4) +
    "｜每趟均值请求=" + avgReq.toFixed(2) + " ⇒ 一轮 ≈ ¥" + perRound.toFixed(5) +
    "｜翻默认最坏新增＝「红过」那 " + String(endedRed.length) + " 趟各多 1 轮 ≈ ¥" + (perRound * endedRed.length).toFixed(4) +
    "（口径：一轮＝整趟均价 ÷ 每趟请求数。返修轮带着同样的上下文，所以这是读大不读小）");
} else {
  console.log("cny 全为 null ⇒ 金额这一格无从判，只能给请求数与 token 数");
}
console.log("最坏新增请求数=" + String(endedRed.length) + "（现有总请求 " + String(sum((r) => r.requests)) + " 的 " +
  String(Math.round((endedRed.length / Math.max(1, sum((r) => r.requests))) * 100)) + "%）");

const ids = [...new Set(endedRed.map((r) => r.id))].sort();
console.log("真模型那一臂的最小实验面（只挑翻默认才会碰到的任务 id）：" + String(ids.length) + " 个" + (ids.length ? "：" + ids.slice(0, 14).join("、") : ""));
const wroteIds = [...new Set(endedRedWrote.map((r) => r.id + "（" + r.file + "）"))].sort();
console.log("更窄的一档——红过**且确认写过盘**的趟（这一档才是返修轮真正会落到的地方）：" + String(endedRedWrote.length) + " 趟／去重后 " + String(wroteIds.length) + " 个：" + wroteIds.join("、"));
