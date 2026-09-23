/**
 * 长时程装配回放 CLI（能力 11）：把靶场从「一次请求」放大到「几十轮」，量**只在多轮才生效**的东西。
 *
 * 为什么要有它：靶场三条 case 实测全是 `requests=1` ⇒ 压缩、裁剪、缓存命中、跨轮回注一次都触发不到；
 * 基线 `successRate:1` 是天花板，任何 harness 改动在这里只能证明「不掉分」，不能证明「买到分」
 * （BLOCKED 裁决 3 的原文）。该裁决留了两条路：① 新增一条 ≥10 轮的**冻结 case**（要动判卷文件），
 * ② 只给探针加放大重放（**不动判卷文件**）。本 CLI 走的是 ②。
 *
 * 它量什么：逐轮装配分层字节（可缓存前缀 / 易变 system / 历史）、**相邻两轮比出来的头部存活比**
 * （= 这一轮作废了多少字符的上一轮前缀，就是重写缓存的钱），以及真落流的 `compaction` 事件数。
 * 还能 A/B 一个开关：`--amortize both` 跑同一条链的关/开两支，直接读差值。
 *
 * 用法：
 *   TERM=dumb node --import tsx scripts/gym-long.ts --all [--turns 8] [--growth 4000] [--amortize both|on|off]
 *   TERM=dumb node --import tsx scripts/gym-long.ts --case <id> [--scale production] [--out long.json]
 * 尺度：`--scale small`（缺省）压小窗口让压缩在几轮内可达，用于回归与开发；
 *       `--scale production` 用生产缺省窗口（128k），需要更多轮才够到阈值——真钱数只能在这一档谈。
 * 红线：只读 `fixtures/gym/**`，写只落临时目录。
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCase, loadGymIndex, gymTempDir, type GymIndexEntry } from "../src/agent/gym/case";
import { replayLongAssembly, diffLongReplay, type LongReplayReport } from "../src/agent/gym/probe";
import { createMockSummarizer } from "../src/agent/compaction";
import { GYM_PROBE_SYSTEM } from "../src/agent/gym/runner";

const argv = process.argv.slice(2);
const pick = (flag: string): string | null => {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`[gym-long] ${flag} 需要一个值（收到：${v === undefined ? "缺省" : v}）`);
    process.exit(2);
  }
  return v;
};
const num = (flag: string, dflt: number): number => {
  const v = pick(flag);
  if (v === null) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`[gym-long] ${flag} 要正整数，收到 ${v}`);
    process.exit(2);
  }
  return n;
};

const all = argv.includes("--all");
const caseId = pick("--case");
const scale = pick("--scale") ?? "small";
const amortizeMode = pick("--amortize") ?? "both";
const outPath = pick("--out");
if (!all && !caseId) {
  console.error("[gym-long] 用法：--all 或 --case <id>；可选 --turns/--growth/--scale/--amortize/--out");
  process.exit(1);
}
if (scale !== "small" && scale !== "production") {
  console.error(`[gym-long] --scale 只认 small|production，收到 ${scale}`);
  process.exit(2);
}

// small 档的窗口/ratio 与 `prefix-churn-check` PC7 同一配方：让触发停在 threshold（overflow 按设计不摊销）。
// tail 三个旋钮一律不覆盖——覆盖了就会落到工作集下限之下，摊销拒绝动作（那是样本不像生产，不是策略坏）。
const SMALL = { inputLimit: 12_000, maxOutputReserve: 400, ratio: 0.35, retryBackoffMs: 1 };
const SUMMARY = "SUMMARY：长时程回放的冻结摘要，内容不重要，重要的是压缩真的落了一次流。";

async function replay(entry: GymIndexEntry, amortize: boolean): Promise<LongReplayReport> {
  const c = await loadCase(GYM, entry);
  const dir = await gymTempDir("gym-long-");
  return replayLongAssembly({
    caseId: entry.id,
    eventsPath: join(dir, "events.jsonl"),
    workspace: dir,
    system: GYM_PROBE_SYSTEM,
    scriptPath: join(c.dir, "script.jsonl"),
    map: false,
    longTurns: num("--turns", scale === "production" ? 60 : 8),
    growthChars: num("--growth", scale === "production" ? 8_000 : 4_000),
    amortize,
    ...(scale === "small" ? { compactionConfig: SMALL } : {}),
    summarizer: createMockSummarizer(SUMMARY),
  });
}

function printTable(r: LongReplayReport): void {
  const pad = (v: string | number, n: number) => String(v).padStart(n);
  console.log(`  轮${"prompt".padStart(9)}${"可缓存".padStart(9)}${"易变sys".padStart(10)}${"历史".padStart(10)}${"头部存活".padStart(11)}${"作废".padStart(10)}`);
  for (const t of r.turns) {
    console.log(
      "  " + pad(t.turn, 2) + pad(t.promptBytes, 9) + pad(t.cacheableBytes, 9) + pad(t.volatileSystemBytes, 10) +
        pad(t.historyBytes, 10) + pad(t.headSurvival === null ? "—" : (t.headSurvival * 100).toFixed(1) + "%", 11) +
        pad(t.rewroteBytes, 10),
    );
  }
  console.log(`  ⇒ 请求 ${String(r.requests)} 次、真落流压缩 ${String(r.compactions)} 次、头部作废 ${String(r.rewrites)} 次、累计作废 ${String(r.totalRewroteBytes)} 字符`);
}

const GYM = join(process.cwd(), "fixtures", "gym");
const index = await loadGymIndex(GYM);
const entries: GymIndexEntry[] = all
  ? [...index.cases]
  : index.cases.filter((e) => e.id === caseId);
if (entries.length === 0) {
  console.error(`[gym-long] 找不到 case "${caseId}"（靶子里有：${index.cases.map((e) => e.id).join("、")}）`);
  process.exit(1);
}
const reports: Record<string, { off: LongReplayReport; on: LongReplayReport | null }> = {};
let blind = 0;
for (const entry of entries) {
  const off = await replay(entry, false);
  console.log(`[gym-long] case=${entry.id} 尺度=${scale} turns=${String(off.longTurns)} growth=${String(off.growthChars)} 摊销=关`);
  printTable(off);
  let on: LongReplayReport | null = null;
  if (amortizeMode !== "off") {
    on = await replay(entry, true);
    const d = diffLongReplay(off, on);
    const saved = off.totalRewroteBytes === 0 ? "n/a" : (100 - (on.totalRewroteBytes / off.totalRewroteBytes) * 100).toFixed(1) + "%";
    console.log(`[gym-long] 摊销=开 ⇒ 压缩 ${String(on.compactions)} 次（关 ${String(off.compactions)}）、累计作废 ${String(on.totalRewroteBytes)} 字符（关 ${String(off.totalRewroteBytes)}，省 ${saved}）｜Δ总 prompt ${String(d.totalPromptBytes)} 字符`);
    // 只压一次时「省 0.0%」不是坏消息，是这条链上本来就没有第二次账可省——
    // 不说清楚，读数会被读成「策略无效」。
    if (off.compactions < 2) {
      console.log(`  ⚠️ 关那一支只压了 ${String(off.compactions)} 次 ⇒ 摊销没有第二次重写可省；要量这条请加 --turns/--growth 或用小窗口（生产尺度下压一次要 ~40 轮）`);
    }
  }
  if (off.compactions === 0) {
    console.log("  ⚠️ 这一档**一次都没压缩** ⇒ 本次读数无分辨力（加 --turns/--growth，或用 --scale small）");
    blind++;
  }
  reports[entry.id] = { off, on };
}
if (outPath) {
  await writeFile(outPath, JSON.stringify({ scale, generatedAt: new Date().toISOString(), reports }, null, 2));
  console.log(`[gym-long] 已写 ${outPath}`);
}
if (blind > 0 && blind === entries.length) {
  console.error("[gym-long] 所有 case 都没触发压缩 ⇒ 别让「跑完了」读成「量到了」");
  process.exit(1);
}
