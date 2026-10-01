/** 把 `probe.mts` 的裸读数（results.json + raw/*.json + raw/*.log）变成报告要的几张表。
 *
 * 为什么另写一份而不是手抄：本仓的纪律是「读数不可复查是评测器的缺陷」——手抄进 README 的数字
 * 没人能重算。这里每张表都由文件重算，跑 `node --import tsx outputs/.../analyze.mts` 即得。
 *
 * 三件事必须分开印，混在一起就是把「树态红」当成「容量红」：
 *   ① **树态红**：树本来就是脏的（`git status --porcelain` 非空）⇒ 凡读真仓状态的判卷（`prose-needle-scan`
 *      是典型：它要求"已提交那一半里不许混进在飞文件"）会**每条臂都红**。这是环境的既有状态，不是并发造成的。
 *   ② **容量红**：只在"一起跑"那条臂出现 ⇒ 再用**单独复跑**确认（单跑绿 = 假红）。
 *   ③ **真红**：臂 Q（依次跑）也红、且单跑仍红。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultTimeoutFromConfig, suiteRows, timingNearCapCell } from "../../scripts/lib/head-cert-deps";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "raw");
const ROOT = join(HERE, "../..");

interface FaceRun { face: string; arm: string; rep: number; exit: number; ms: number; cmd: string; }
interface Sample { tag: string; ms: number; load1: string; nodeProcs: number; rssMb: number; suites: number; }
const results = JSON.parse(readFileSync(join(HERE, "results.json"), "utf8")) as {
  runs: FaceRun[]; samples: Sample[]; notes: string[]; nearCap: Record<string, string>;
  phases?: string[]; suites?: number;
};

const ms = (n: number): string => (n < 1000 ? `${String(n)}ms` : `${(n / 1000).toFixed(1)}s`);
const pct = (a: number, b: number): string => `${((100 * a) / b).toFixed(1)}%`;

/** ① 每臂每面：退出码与墙钟。判「面」绿红只看退出码 —— 与 CI 同口径。 */
function tableRuns(): void {
  console.log("\n### 各面各臂读数（exit=0 绿）\n");
  console.log("| 臂 | 趟 | 面 | exit | 墙钟 |");
  console.log("|---|---:|---|---:|---:|");
  for (const r of results.runs) {
    console.log(`| ${r.arm} | ${String(r.rep)} | ${r.face} | ${r.exit === 0 ? "0 ✅" : `**${String(r.exit)} ❌**`} | ${ms(r.ms)} |`);
  }
}

/** 并发条件：我是刻意在"环境里已有别的会话在跑判卷"那一刻抢跑的，所以这段是读数的定性前提。 */
function tableAmbient(): void {
  // 只统计**臂内**的采样点（tag 形如 `C-r1`／`Q-r1`）。`start`／`end` 这类边界点在每个阶段各采一次，
  // 两个阶段合成一份 results.json 后同名，合起来印会把两条臂的条件混成一行（那是误读，不是汇总）。
  const s = results.samples.filter((x) => /-r\d+$/u.test(x.tag));
  const suites = s.map((x) => x.suites).filter((n) => n >= 0);
  const load = s.map((x) => Number(x.load1)).filter(Number.isFinite);
  const rss = s.map((x) => x.rssMb);
  const procs = s.map((x) => x.nodeProcs);
  const rng = (a: number[]): string => (a.length === 0 ? "没采到" : `${Math.min(...a)}–${Math.max(...a)}`);
  console.log("\n### 并发条件（臂内每 2s 采一次：`ps -eo pid,pgid,rss,command` + `uptime`）\n");
  console.log(`- 臂内采样点 ${String(s.length)} 个（起跑前/收工后的边界点不计入——它们跨阶段同名）`);
  console.log(`- 环境里的**别的判卷套数**（仓里现成的 \`countConcurrentSuites\`，按 pgid 去重）：${rng(suites)}`
    + `（取不到的点 ${String(s.length - suites.length)} 个）`);
  console.log(`- load average(1m)：${rng(load)}`);
  console.log(`- node 进程数：${rng(procs)}；RSS 合计：${rng(rss)}MB（峰 ${String(Math.max(...rss))}MB）`);
  const byTag = new Map<string, Sample[]>();
  for (const x of s) byTag.set(x.tag, [...(byTag.get(x.tag) ?? []), x]);
  console.log("\n| 采样段 | 点数 | 判卷套数 | load1 | node 进程 | RSS 合计 MB |");
  console.log("|---|---:|---|---:|---:|---:|");
  for (const [tag, xs] of byTag) {
    console.log(`| ${tag} | ${String(xs.length)} | ${rng(xs.map((x) => x.suites))} | ${rng(xs.map((x) => Number(x.load1)))} `
      + `| ${rng(xs.map((x) => x.nodeProcs))} | ${rng(xs.map((x) => x.rssMb))} |`);
  }
}

/** ② 每份判卷 json 里的**失败用例**逐个列名。失败消息只留第一行（栈没用，且能把报告撑爆）。 */
function tableFailures(): void {
  console.log("\n### 判卷 json 里的失败用例（逐条列名）\n");
  for (const tag of ["quiet", "a", "b"]) {
    const p = join(RAW, `suite-${tag}.json`);
    if (!existsSync(p)) { console.log(`- \`suite-${tag}.json\`：**不存在** ⇒ 这一格没量到`); continue; }
    const j = JSON.parse(readFileSync(p, "utf8")) as {
      numTotalTests?: number; numPassedTests?: number; numFailedTests?: number; success?: boolean;
      testResults?: { name: string; assertionResults: { fullName: string; status: string; duration?: number; failureMessages?: string[] }[] }[];
    };
    const failed: { file: string; full: string; ms: number; msg: string }[] = [];
    for (const tr of j.testResults ?? []) {
      for (const a of tr.assertionResults ?? []) {
        if (a.status === "passed") continue;
        failed.push({
          file: tr.name.replace(`${ROOT}/`, ""),
          full: a.fullName,
          ms: a.duration ?? 0,
          msg: (a.failureMessages ?? []).join("\n").split("\n").find((l) => l.trim() !== "") ?? "",
        });
      }
    }
    console.log(`- \`suite-${tag}.json\`：${String(j.numTotalTests ?? 0)} 条，通过 ${String(j.numPassedTests ?? 0)}，`
      + `**红 ${String(j.numFailedTests ?? 0)}**${j.success === false ? "（success=false）" : ""}`);
    for (const f of failed) {
      const short = f.msg.replace(/^AssertionError:\s*/u, "").replace(/^Error:\s*/u, "");
      console.log(`  - \`${f.file}\` · ${f.full.slice(0, 70)} · ${ms(Math.round(f.ms))} · ${short.slice(0, 150)}`);
    }
  }
}

/** 逐条用例 vs 自己的预算：**离帽多近**才是"容量红"的可解释形状。复用仓里的 helper，不另抄一份贴帽算法。 */
function tableNearCap(): void {
  console.log("\n### 逐条用例 vs 自己的预算（贴帽 = 用时 ≥ 有效预算 80%）\n");
  for (const [tag, v] of Object.entries(results.nearCap)) console.log(`- **${tag}**：${v}`);
  // 明细：每份 json 里离帽最近的 5 条，便于肉眼核对"红的那条是不是就在帽上"。
  let cfg: string | null = null;
  try { cfg = readFileSync(join(ROOT, "tests/vitest.config.ts"), "utf8"); } catch { cfg = null; }
  const budget = defaultTimeoutFromConfig(cfg);
  console.log(`\n有效缺省预算 ${String(budget.ms)}ms（来源：${budget.source}）`);
  console.log("\n| json | 用例 | 用时 | 预算 | 占比 |");
  console.log("|---|---|---:|---:|---:|");
  for (const tag of ["quiet", "a", "b"]) {
    const p = join(RAW, `suite-${tag}.json`);
    if (!existsSync(p)) continue;
    const rows = suiteRows(readFileSync(p, "utf8"), `${ROOT}/`);
    const cell = timingNearCapCell(rows, {
      defaultBudget: budget,
      readTest: (rel) => { try { return readFileSync(join(ROOT, rel), "utf8"); } catch { return null; } },
      slowLimit: 5,
    });
    for (const r of cell.slowest) {
      console.log(`| ${tag} | ${r.file.replace(/^tests\//u, "")}·${r.full.slice(0, 34)} | ${String(Math.round(r.ms))}ms `
        + `| ${String(r.budget)}ms | ${pct(r.ms, r.budget)} |`);
    }
  }
}

console.log(`# M10 多面一起跑 · 假红率读数\n`);
console.log(`阶段：${(results.phases ?? []).join(" ｜ ")}\n`);
tableRuns();
tableAmbient();
tableFailures();
tableNearCap();
if (results.notes.length > 0) {
  console.log("\n### 备注\n");
  for (const n of results.notes) console.log(`- ⚠️ ${n}`);
}
