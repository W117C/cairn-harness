/** M10 读数探针：**「多面验证一起跑」时各面的假红率**（2026-10-01）。
 *
 * 这是哪一格：本仓的 `scripts/lib/head-cert-deps.ts` 早就把「撞窗」写成了两句话——
 *   `collisionHint`：「判卷有红，且两端采到 N 套判卷并行 ⇒ 先排撞窗再查代码（判卷面有写共享 /tmp 的用例，
 *   两套并行会互踩出假红；本次读数不是独占跑的）」；
 *   `timingNearCapCell`：「**安静态这一格读数是 0 条**，这是事实不是缺陷：这一格量的是"隔壁会话在同一台
 *   机器上跑起来的那一刻"，而那一时刻恰好就是红发生的那一刻」。
 * ⇒ **机制量到过撞窗，撞窗那一刻的假红率没有读数**。本探针去补那一格。
 *
 * 跑法：`node --import tsx outputs/m10-face-false-red-2026-10-01/probe.mts [--reps=2] [--arms=Q,C]`
 * 口径（README 里也印一遍，免得读的人自己猜）：
 *   · 假红的定义：**树没动**（每趟前后 `git rev-parse HEAD` + `git status --porcelain` + `git diff --stat`
 *     逐字相同）而某面报红 ⇒ 那一次红是假的；再用**单独复跑**确认（单跑绿 ⇒ 假红，单跑也红 ⇒ 真红，不算进分子）。
 *   · 「一起跑」= typecheck + 两套全量判卷 + 快门面**同时起**（依次跑不存在撞窗）。为什么两套判卷：本机是
 *     「一个人开多 agent」的常态，两个会话各跑一次全量就是那个形状；两套跑在**同一棵树**上是刻意加重
 *     （共享 /tmp 名 + 共享 vitest 缓存），属最坏情形，报告里如实标注。
 *   · 「各面」= 判卷（test）／类型面（typecheck）／门面（gates 快门面 20 道）。本仓没有 lint script，
 *     门面就是 lint 那一格的位置（`src/agent/verify.ts:73` 的 `lint?: string[]` 在本仓是空的）。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { countConcurrentSuites, defaultTimeoutFromConfig, suiteRows, timingNearCapCell } from "../../scripts/lib/head-cert-deps";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const RAW = join(HERE, "raw");
mkdirSync(RAW, { recursive: true });

/** M9 的 CI 快门面（`.github/workflows/verify.yml` 逐字点名的那 20 道）= 本仓的「门面」。 */
const SHUTTER = [
  "no-progress-check", "prune-check", "fork-check", "compaction-check", "docs-check", "memory-check",
  "head-import-check", "autonomy-check", "sandbox:check", "security-check", "provider:check",
  "routing-check", "model-surface-check", "prefix-churn-check", "prompt-surface-check",
  "replay-determinism-check", "cost-per-progress-check", "web-fetch-check", "gym-check",
  "evidence-typecheck-check",
];

const argv = process.argv.slice(2);
const arg = (name: string, dflt: string): string =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const REPS = Number(arg("reps", "2"));
const ARMS = new Set(arg("arms", "Q,C").split(",").map((s) => s.trim()));
/** 臂 C 里我自己起几套判卷。缺省 2 = 本机「两个会话各跑一次」的形状；若**环境里已有别的会话在跑**
 *  （`countConcurrentSuites` 采到 >0），就跑 1 套，让「环境 1 + 我 1」凑成同一形状——
 *  既拿到真撞窗读数，也不在这台 8 核 8GB 的机器上凭空多压一套（用户点名在意 CPU/内存）。 */
const SUITES = Number(arg("suites", "2"));

interface FaceRun { face: string; arm: string; rep: number; exit: number; ms: number; cmd: string; }
interface Sample { tag: string; ms: number; load1: string; nodeProcs: number; rssMb: number; suites: number; }

const runs: FaceRun[] = [];
const samples: Sample[] = [];
const notes: string[] = [];
const now = (): number => Number(process.hrtime.bigint() / 1_000_000n);

/** 树指纹：三样都要——HEAD 单看会漏在飞改动，`status` 单看会漏 index 上的差异。 */
function fingerprint(): string {
  const g = (args: string[]): string =>
    spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }).stdout ?? "";
  return [g(["rev-parse", "HEAD"]), g(["status", "--porcelain"]), g(["diff", "--stat"])].join("\n");
}

function suiteFace(face: string, tag: string): { face: string; cmd: string; args: string[] } {
  return {
    face,
    cmd: "node",
    args: ["node_modules/vitest/vitest.mjs", "run", "--config", "tests/vitest.config.ts",
      "--reporter=default", "--reporter=json", `--outputFile.json=${join(RAW, `suite-${tag}.json`)}`],
  };
}

const TYPECHECK = { face: "typecheck", cmd: "node", args: ["--import", "tsx", "scripts/typecheck.ts"] };
const GATES = { face: "gates", cmd: "node", args: ["--import", "tsx", "scripts/gates.ts", `--only=${SHUTTER.join(",")}`] };
/** 一起跑那几条：两套同名判卷是**故意**的（两个会话各跑一次的样子），不是笔误。 */
const TOGETHER: { face: string; cmd: string; args: string[] }[] = [
  TYPECHECK, ...["a", "b"].slice(0, SUITES).map((t) => suiteFace(`test-${t}`, t)), GATES,
];

function spawnFace(f: { face: string; cmd: string; args: string[] }, arm: string, rep: number, logTo: string): Promise<FaceRun> {
  const t0 = now();
  return new Promise((settle) => {
    const child = spawn(f.cmd, f.args, { cwd: ROOT, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => { out += String(d); });
    child.stderr?.on("data", (d: Buffer) => { out += String(d); });
    const finish = (code: number): void => {
      writeFileSync(join(RAW, logTo), out);
      settle({ face: f.face, arm, rep, exit: code, ms: now() - t0, cmd: [f.cmd, ...f.args].join(" ") });
    };
    child.on("error", () => finish(127));
    child.on("close", (code) => finish(code ?? 1));
  });
}

/** 采样：这台机器上有几个 node 进程、占多少 RSS、几套判卷（用仓里现成的 `countConcurrentSuites` 狗粮一次）、负载。 */
function sampleOnce(tag: string): void {
  const ps = spawnSync("ps", ["-eo", "pid,pgid,rss,command"], { encoding: "utf8" });
  const lines = (ps.stdout ?? "").split("\n").filter((l) => /(^|\/|\s)node(\s|$)/.test(l));
  let rssKb = 0;
  let procs = 0;
  for (const l of lines) {
    const rss = Number(l.trim().split(/\s+/)[2]);
    if (Number.isFinite(rss)) { rssKb += rss; procs += 1; }
  }
  const up = (spawnSync("uptime", [], { encoding: "utf8" }).stdout ?? "").trim();
  const load1 = /load averages?:\s*([0-9.]+)/.exec(up)?.[1] ?? "?";
  const suites = countConcurrentSuites(ps.stdout ?? null);
  samples.push({ tag, ms: now(), load1, nodeProcs: procs, rssMb: Math.round(rssKb / 1024), suites });
  writeFileSync(join(RAW, `samples-${tag}.jsonl`), samples.map((s) => JSON.stringify(s)).join("\n") + "\n");
}

const PHASE = `arms=${[...ARMS].sort().join("+")};reps=${String(REPS)};suites=${String(SUITES)}`;

/** 落盘**合并**而不覆盖：臂 Q 与臂 C 是两次调用（臂 C 必须趁"环境里真有别的会话在跑"那一刻抢跑，
 *  不能等），而读数必须合成一份 results.json，否则后跑的那次会把前一次的读数抹掉。
 *
 *  **上一次写坏过，记在这儿**：原先每次 `persist()` 都现读一次 results.json 来判"是不是新阶段"——
 *  而同一进程里 `persist()` 会被调两次（每趟收工时一次、收工后一次），第二次读到的是**自己刚写的**那份，
 *  `phase` 当然相同 ⇒ 判成"同阶段" ⇒ 拿内存里那份（只有本进程这几条）覆盖掉刚合并好的结果，
 *  臂 C 的读数就这么丢了（裸日志还在，但机器可读的那张表没了）。
 *  ⇒ 改成**每进程只读一次**纸面，之后一律"带过来的 + 自己的"。 */
let carried: { runs: FaceRun[]; samples: Sample[]; notes: string[]; phases: string[] } | null = null;
function persist(): void {
  const p = join(HERE, "results.json");
  if (carried === null) {
    carried = { runs: [], samples: [], notes: [], phases: [] };
    try {
      const prev = JSON.parse(readFileSync(p, "utf8")) as { phase?: string; phases?: string[]; runs?: FaceRun[]; samples?: Sample[]; notes?: string[] };
      if (prev.phase !== undefined && prev.phase !== PHASE) {
        carried = { runs: prev.runs ?? [], samples: prev.samples ?? [], notes: prev.notes ?? [], phases: [...(prev.phases ?? []), prev.phase] };
      }
    } catch { carried = { runs: [], samples: [], notes: [], phases: [] }; }
  }
  writeFileSync(p, JSON.stringify({
    phases: [...new Set([...carried.phases, PHASE])],
    phase: PHASE, reps: REPS, arms: [...ARMS], suites: SUITES, shutter: SHUTTER,
    runs: [...carried.runs, ...runs],
    samples: [...carried.samples, ...samples],
    notes: [...carried.notes, ...notes],
    nearCap: nearCap(),
  }, null, 1));
}

async function arm(name: string, reps: number): Promise<void> {
  for (let rep = 1; rep <= reps; rep += 1) {
    const before = fingerprint();
    console.log(`\n== 臂 ${name} 第 ${rep}/${reps} 趟 ==`);
    const t0 = now();
    const ticker = setInterval(() => sampleOnce(`${name}-r${rep}`), 2_000);
    // 臂 C = 同时起、等齐再收；臂 Q = 依次起（对照与真红基线）。
    const planned = name === "C" ? TOGETHER : [TYPECHECK, suiteFace("test-a", "quiet"), GATES];
    const tasks = name === "C"
      ? planned.map((f) => spawnFace(f, name, rep, `${name}-r${rep}-${f.face}.log`))
      : [];
    if (name !== "C") {
      for (const f of planned) {
        const r = await spawnFace(f, name, rep, `${name}-r${rep}-${f.face}.log`);
        runs.push(r);
        console.log(`   ${r.exit === 0 ? "✅" : "❌"} ${r.face.padEnd(10)} exit=${String(r.exit)} ${String(r.ms)}ms`);
      }
    } else {
      for (const r of await Promise.all(tasks)) {
        runs.push(r);
        console.log(`   ${r.exit === 0 ? "✅" : "❌"} ${r.face.padEnd(10)} exit=${String(r.exit)} ${String(r.ms)}ms`);
      }
    }
    clearInterval(ticker);
    console.log(`   本趟墙钟 ${((now() - t0) / 1000).toFixed(1)}s`);
    const after = fingerprint();
    if (after !== before) notes.push(`臂 ${name} 第 ${rep} 趟期间**树变了** ⇒ 这一趟不能用来判假红（判据要求前后指纹逐字相同）`);
    persist();
  }
}

/** 逐条用例的预算读数：安静态 vs 撞窗态。用仓里现成的 `suiteRows` + `timingNearCapCell`，
 *  不在探针里另抄一份「谁贴帽」的算法（第十三族：同一谓词只留一份）。 */
function nearCap(): Record<string, string> {
  let cfgText: string | null = null;
  try { cfgText = readFileSync(join(ROOT, "tests/vitest.config.ts"), "utf8"); } catch { cfgText = null; }
  const budget = defaultTimeoutFromConfig(cfgText);
  const readTest = (rel: string): string | null => {
    try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; }
  };
  const out: Record<string, string> = {};
  for (const tag of ["quiet", "a", "b"]) {
    const p = join(RAW, `suite-${tag}.json`);
    if (!existsSync(p)) { out[tag] = `${p} 不存在 ⇒ 这一格没量到（不等于「0 条贴帽」）`; continue; }
    const rows = suiteRows(readFileSync(p, "utf8"), ROOT + "/");
    const cell = timingNearCapCell(rows, { defaultBudget: budget, readTest });
    if (cell.state === "unreadable") { out[tag] = `suite-${tag}.json 形状不认识 ⇒ 这一格没量到`; continue; }
    const row = (s: (typeof cell.slowest)[number]): string =>
      `${s.file.replace(/^tests\//u, "")}·${s.full.slice(0, 26)} ${String(Math.round(s.ms))}/${String(s.budget)}ms=${String(Math.round(s.ratio * 100))}%`;
    out[tag] = `${String(cell.total)} 条｜贴帽 ${String(cell.near.length)} 条｜无显式预算 ${String(cell.implicit)} 条`
      + `｜离帽最近：${cell.slowest.map(row).join("；")}（${cell.defaultSource}）`;
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`根=${ROOT}`);
  // 横幅要按**这条臂真会起的那几条面**印：臂 Q 依次起 3 条（1 套判卷），臂 C 一起起 4 条（2 套判卷）。
  // 原先一律印 TOGETHER 那份清单，跑 `--arms=Q` 时会印出「自起 2 套判卷」而实际只起 1 套（误导读数的人）。
  console.log(`臂 Q：依次起 typecheck → 判卷 → 快门面（1 套判卷）`);
  console.log(`臂 C：同时起 ${TOGETHER.map((f) => f.face).join(" + ")}（${String(SUITES)} 套判卷）`);
  console.log(`本次跑：臂=${[...ARMS].join("、")}；每臂 ${String(REPS)} 趟`);
  sampleOnce("start");
  const ambient0 = samples[samples.length - 1]?.suites ?? -1;
  console.log(`起跑时环境里已有 ${String(ambient0)} 套别的判卷在跑（-1=取不到；0=真独占）⇒ 臂 C 期间总判卷数 = 环境 + ${String(SUITES)}`);
  notes.push(`起跑时环境判卷套数=${String(ambient0)}（-1=取不到；0=真独占）`);
  if (ARMS.has("Q")) await arm("Q", 1);
  if (ARMS.has("C")) await arm("C", REPS);
  sampleOnce("end");
  persist();
  console.log("\n== 贴帽读数（判卷逐条用例 vs 其预算）==");
  for (const [k, v] of Object.entries(nearCap())) console.log(`  ${k}：${v}`);
  if (notes.length > 0) { console.log("\n== 备注 =="); for (const n of notes) console.log("  ⚠️ " + n); }
  console.log("\n结果已落 results.json");
}

await main();
