/** #66 的对照读数：A＝装收束闸不装返修（产品缺省），B＝两者都装（候选缺省）。同 HEAD、同任务集、同一天。
 *  三条硬规矩写在这里：
 *  ① **单变量自证**——两臂的 `assembly` 串必须只差 `autoVerifyRepair` 那一枚，差别的不是返修 ⇒ 整组作废；
 *  ② **只取配对**——分母＝两臂都出现的任务 id，单边缺席逐条点名，不混进均值；
 *  ③ **没触发就不许说"没差别"**——若 B 臂一次返修都没发生，这一组对照**没有分辨力**，得报成"未测到"。
 *  reps=1 ⇒ 只出单次配对读数，不宣称趋势（跑器自己也是这条口径）。 */
import { readFileSync } from "node:fs";

interface Row {
  id: string; ok: boolean; seedVerifyOk: boolean | null; verifyOkLast: boolean | null;
  recovery: string | null; beats: number; requests: number; tokensIn: number; tokensOut: number;
  seconds: number; cny: number | null; assembly: string | null; exitError: string | null;
}

function load(path: string): Row[] {
  const j = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const arr = Array.isArray(j) ? j : Object.values(j as Record<string, unknown>);
  const out: Row[] = [];
  const face = new Map<string, number>();
  for (const item of arr) {
    const wrap = item as { r?: Record<string, unknown>; g?: { ok?: boolean } };
    const r = wrap.r ?? (item as Record<string, unknown>);
    if (!r || typeof r !== "object" || !("id" in r)) continue;
    for (const k of ["verifyOkLast", "verifyRecovery", "autoVerifyBeats", "assembly", "seedVerifyOk", "cny"]) {
      face.set(k, (face.get(k) ?? 0) + (k in r ? 1 : 0));
    }
    out.push({
      id: String(r.id),
      ok: Boolean(wrap.g?.ok ?? (r as Record<string, unknown>).ok),
      seedVerifyOk: "seedVerifyOk" in r ? Boolean(r.seedVerifyOk) : null,
      verifyOkLast: "verifyOkLast" in r ? Boolean(r.verifyOkLast) : null,
      recovery: "verifyRecovery" in r ? String(r.verifyRecovery) : null,
      beats: Number(r.autoVerifyBeats ?? 0),
      requests: Number(r.requests ?? 0),
      tokensIn: Number(r.tokensIn ?? 0),
      tokensOut: Number(r.tokensOut ?? 0),
      seconds: Number(r.seconds ?? 0),
      cny: typeof r.cny === "number" && Number.isFinite(r.cny) ? r.cny : null,
      assembly: "assembly" in r ? String(r.assembly) : null,
      exitError: r.exitError == null ? null : String(r.exitError),
    });
  }
  console.log(`${path.split("/").pop()}: 趟次=${String(out.length)}｜字段可用面=` +
    [...face.entries()].map(([k, v]) => `${k} ${String(v)}/${String(out.length)}`).join(" "));
  return out;
}

const PA = process.argv[2] ?? "outputs/repair-arm-ab-2026-10-04/a50/readings.json";
const PB = process.argv[3] ?? "outputs/repair-arm-ab-2026-10-04/b50/readings.json";
const A = load(PA);
const B = load(PB);

// ① 单变量自证
const knobSet = (s: string | null): Set<string> => new Set((s ?? "").split(/\s+/u).filter((x) => x !== "").map((x) => x.split(":")[0] + ":" + x.split(":")[1]));
const diff = (x: Set<string>, y: Set<string>): string[] => [...x].filter((k) => !y.has(k)).concat([...y].filter((k) => !x.has(k)));
const aAsm = A[0]?.assembly ?? null, bAsm = B[0]?.assembly ?? null;
const onlyRepairDiffers = aAsm !== null && bAsm !== null &&
  diff(knobSet(aAsm), knobSet(bAsm)).every((t) => t.startsWith("autoVerifyRepair")) &&
  aAsm.includes("autoVerify:same") && bAsm.includes("autoVerify:same");
console.log("单变量自证：A 装配「" + (aAsm ?? "无") + "」");
console.log("            B 装配「" + (bAsm ?? "无") + "」");
console.log(onlyRepairDiffers ? "  ⇒ 两臂只差返修那一枚，且收束闸两臂都装 ⇒ 这一组配得上『翻默认』这个问题"
  : "  ⚠️ 差别不止返修那一枚 ⇒ 整组读数只能当两副不同装配的并列，不能当 A/B");

// ①b 可达性：那一拍住在「模型不再发工具调用」的收束支里（`src/agent/loop.ts:573`），
// 所以**被步数帽砍掉的回合结构上走不到它**。这一行决定整组读数能不能回答 `#66`。
const capped = (rows: Row[]): number => rows.filter((r) => r.exitError !== null && r.exitError.includes("maxSteps")).length;
console.log("收束闸可达性：撞步数帽的趟 A=" + String(capped(A)) + "/" + String(A.length) + " B=" + String(capped(B)) + "/" + String(B.length) +
  "（撞帽的趟走不到收束支 ⇒ 那一拍在它们身上不可能响）");

// ② 配对
const byId = (rows: Row[]): Map<string, Row> => new Map(rows.map((r) => [r.id, r]));
const ma = byId(A), mb = byId(B);
const paired = [...ma.keys()].filter((k) => mb.has(k)).sort();
const onlyA = [...ma.keys()].filter((k) => !mb.has(k)).sort();
const onlyB = [...mb.keys()].filter((k) => !ma.has(k)).sort();
console.log("配对分母=" + String(paired.length) + "｜只在 A=" + String(onlyA.length) + (onlyA.length ? "（" + onlyA.join("、") + "）" : "") +
  "｜只在 B=" + String(onlyB.length) + (onlyB.length ? "（" + onlyB.join("、") + "）" : ""));

let fixed = 0, broke = 0, bothOk = 0, bothBad = 0;
const lines: string[] = [];
for (const id of paired) {
  const a = ma.get(id) as Row, b = mb.get(id) as Row;
  const cls = a.ok && b.ok ? "两臂都过" : !a.ok && !b.ok ? "两臂都红" : !a.ok && b.ok ? "A 红 B 绿（返修救回）" : "A 绿 B 红（返修反而坏）";
  if (a.ok && b.ok) bothOk += 1; else if (!a.ok && !b.ok) bothBad += 1; else if (!a.ok) fixed += 1; else broke += 1;
  lines.push(`  ${id.padEnd(24)} A=${a.ok ? "过" : "红"} B=${b.ok ? "过" : "红"}｜闸拍 A=${String(a.beats)} B=${String(b.beats)}` +
    `｜req ${String(a.requests)}→${String(b.requests)} 入token ${String(a.tokensIn)}→${String(b.tokensIn)} 出token ${String(a.tokensOut)}→${String(b.tokensOut)} 秒 ${a.seconds.toFixed(0)}→${b.seconds.toFixed(0)}`);
}
console.log("逐对（A→B）：\n" + lines.join("\n"));
console.log("结局四象限：返修救回=" + String(fixed) + "｜返修反坏=" + String(broke) + "｜两臂都过=" + String(bothOk) + "｜两臂都红=" + String(bothBad));

// ④ 噪声底线：**同一副装配**跑两趟会翻几个任务（拿隔壁刚跑的两趟同装配留档算，不是我从记忆里填的常数）。
// 低于这条线的 A/B 差不能读成"返修有用／没用"——这条线是 reps=1 的配对自己唯一的尺。
function flipCount(pa: string, pb: string): { denom: number; flips: number; which: string[] } {
  const ra = byId(loadQuiet(pa)), rb = byId(loadQuiet(pb));
  const ids = [...ra.keys()].filter((k) => rb.has(k));
  const which = ids.filter((k) => (ra.get(k) as Row).ok !== (rb.get(k) as Row).ok);
  return { denom: ids.length, flips: which.length, which };
}
function loadQuiet(path: string): Row[] {
  const j = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const arr = Array.isArray(j) ? j : Object.values(j as Record<string, unknown>);
  return arr.map((item) => {
    const wrap = item as { r?: Record<string, unknown>; g?: { ok?: boolean } };
    const r = wrap.r ?? (item as Record<string, unknown>);
    return { id: String(r.id), ok: Boolean(wrap.g?.ok) } as Row;
  }).filter((r) => r.id !== "undefined");
}
const NOISE_A = "outputs/bench-head-d0ffe15e-a/readings.json";
const NOISE_B = "outputs/bench-head-d0ffe15e-b/readings.json";
try {
  const n = flipCount(NOISE_A, NOISE_B);
  console.log("噪声底线（同装配两趟，取料＝" + NOISE_A.split("/")[1] + " vs " + NOISE_B.split("/")[1] + "）：" +
    String(n.flips) + "/" + String(n.denom) + " 个任务结局翻了（" + n.which.join("、") + "）" +
    " ⇒ A/B 里小于这个数的翻转不能读成返修的效果，只能说落在噪声里");
} catch (e) {
  console.log("⚠️ 噪声底线没算出来（" + String(e instanceof Error ? e.message : e).slice(0, 80) + "）⇒ 下面的配对读数没有对照尺，别当成结论");
}

// ③ 分辨力哨兵：B 臂到底有没有发生返修
const bRepaired = B.filter((r) => r.beats >= 2).length;
const aRepaired = A.filter((r) => r.beats >= 2).length;
const dist = (rows: Row[]): string => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.recovery ?? "无这一格", (m.get(r.recovery ?? "无这一格") ?? 0) + 1);
  return [...m.entries()].sort().map(([k, v]) => k + "=" + String(v)).join(" ");
};
console.log("机制核验：≥2 拍（返修真给了）A=" + String(aRepaired) + " B=" + String(bRepaired) +
  "｜verifyRecovery 分布 A[" + dist(A) + "] B[" + dist(B) + "]");
if (bRepaired === 0) {
  console.log("⚠️ 分辨力=无：B 臂一次返修都没发生 ⇒ 这组读数**测不到**『翻默认有没有用』，只能说明这批任务没走到『闸拍出代码红』那一格。");
  console.log("   下一步不是改口径，是换一个会走到那一格的题面（第 360 页列的那 7 趟就是候选）。");
}

const sum = (rows: Row[], pick: (r: Row) => number): number => rows.reduce((a, r) => a + pick(r), 0);
const inP = paired.map((id) => ma.get(id) as Row), bP = paired.map((id) => mb.get(id) as Row);
const priceKnown = inP.concat(bP).every((r) => r.cny !== null);
console.log("成本（同一配对分母）：请求 A=" + String(sum(inP, (r) => r.requests)) + " B=" + String(sum(bP, (r) => r.requests)) +
  "（Δ" + String(sum(bP, (r) => r.requests) - sum(inP, (r) => r.requests)) + "）｜" +
  "入 token A=" + String(sum(inP, (r) => r.tokensIn)) + " B=" + String(sum(bP, (r) => r.tokensIn)) +
  "｜出 token A=" + String(sum(inP, (r) => r.tokensOut)) + " B=" + String(sum(bP, (r) => r.tokensOut)) +
  "｜墙钟 A=" + (sum(inP, (r) => r.seconds) / 60).toFixed(1) + "min B=" + (sum(bP, (r) => r.seconds) / 60).toFixed(1) + "min");
console.log(priceKnown
  ? "钱：A=¥" + (sum(inP, (r) => r.cny as number)).toFixed(4) + " B=¥" + (sum(bP, (r) => r.cny as number)).toFixed(4) +
    "（EVAL_PRICE_IN/OUT 给了 ⇒ 可算）"
  : "钱：这一格无从判（env 里没有 EVAL_PRICE_IN/EVAL_PRICE_OUT ⇒ cny=NaN），所以只报 token 与请求数，不编一个价。");
const errA = inP.filter((r) => r.exitError !== null).map((r) => r.id + "：" + String(r.exitError).slice(0, 60));
const errB = bP.filter((r) => r.exitError !== null).map((r) => r.id + "：" + String(r.exitError).slice(0, 60));
console.log("退出异常：A=" + String(errA.length) + (errA.length ? " [" + errA.join(" / ") + "]" : "") +
  "｜B=" + String(errB.length) + (errB.length ? " [" + errB.join(" / ") + "]" : ""));
