// 门禁观测账本：把 `pnpm gates` 已经算出来的每道门 ms 落成生成物，并提供一条读表命令。
//
// 存在的理由是**消灭手抄**：文档里那句"~800s 的 test 门"抄自 gates.ts 当场就有的数字，
// 而它随宿主负载变——实测同一棵树全量链路里是 54.1s，差一个数量级。值留在生成物里，
// 文档只写「见 pnpm facts」。spec §4：docs/superpowers/specs/2026-09-19-doc-layer-budget-design.md
//
// 本文件被 tests/ 直接 import，故顶层执行必须挂在 invokedDirectly 闸后（同 docs-check.ts 的处置）。

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hostname } from "node:os";

export interface GateRun {
  gate: string;
  exit: number;
  ms: number;
  unverified: number;
}

export interface RunEntry {
  ts: string;
  host: string;
  gates: GateRun[];
  /**
   * 本次跑了多少道门 / 清单一共多少道。缺省 = 旧账本没记（不许把它读成"整跑"）。
   * 动因：`pnpm gates --only=typecheck` 也写一条 entry，而页头原先一律写「本次整跑」——
   * 2026-09-23 我据此把一次 1 道门的调试读成了"整跑 0.0 分钟"，差点拿去当耗时证据。
   */
  scope?: { ran: number; total: number };
}

export interface FactsLedger {
  version: 1;
  runs: RunEntry[];
}

export interface FactRow {
  gate: string;
  lastExit: number;
  lastMs: number;
  lastUnverified: number;
  maxMs: number;
  samples: number;
}

/** 环形上限：账本自己不许长成第四份 PROGRESS.md。 */
export const FACTS_RUN_CAP = 12;
export const FACTS_PATH = "docs/facts/gates.json";

/** 追加一次整跑，超出上限丢最旧。 */
export function pushRun(ledger: FactsLedger | null, run: RunEntry, cap: number = FACTS_RUN_CAP): FactsLedger {
  const runs = [...(ledger?.runs ?? []), run];
  return { version: 1, runs: runs.slice(Math.max(0, runs.length - cap)) };
}

/** 每道门一行读数：最近一次 + 历史最贵，按最贵在前（"砍哪道门省时间"直接读表）。 */
export function summarize(ledger: FactsLedger): FactRow[] {
  const acc = new Map<string, FactRow>();
  for (const run of ledger.runs) {
    for (const g of run.gates) {
      const prev = acc.get(g.gate);
      acc.set(g.gate, {
        gate: g.gate,
        lastExit: g.exit,
        lastMs: g.ms,
        lastUnverified: g.unverified,
        maxMs: Math.max(prev?.maxMs ?? 0, g.ms),
        samples: (prev?.samples ?? 0) + 1,
      });
    }
  }
  return [...acc.values()].sort((a, b) => b.maxMs - a.maxMs);
}

const secs = (ms: number): string => (ms / 1000).toFixed(1) + "s";

/**
 * 一条 run 的范围标签。三种状态都要说得出口：整跑、子集（`--only=`）、
 * 以及**旧账本没记范围**——最后这一种不许读成"整跑"，也不许读成"子集"，只能如实说没记。
 */
export function runScopeLabel(run: RunEntry): string {
  const s = run.scope;
  if (!s) return "范围未记（旧账本没这个字段）";
  if (s.ran >= s.total) return "整跑 " + String(s.total) + " 道门";
  return "子集 " + String(s.ran) + "/" + String(s.total) + " 道门——不是整跑";
}

export function formatFacts(ledger: FactsLedger | null): string {
  if (!ledger || ledger.runs.length === 0) {
    return [
      `facts: ${FACTS_PATH} 还没有账本——跑一次 \`pnpm gates\` 即生成。`,
      "     （耗时随宿主负载漂，所以值只活在账本里，文档只写「见 pnpm facts」。）",
    ].join("\n");
  }
  const last = ledger.runs[ledger.runs.length - 1]!;
  const rows = summarize(ledger);
  const width = Math.max(...rows.map((r) => r.gate.length));
  const lines = rows.map((r) => {
    const flag = r.lastExit === 0 ? "ok " : "exit" + String(r.lastExit);
    const uv = r.lastUnverified > 0 ? "  未证 " + String(r.lastUnverified) : "";
    return "  " + r.gate.padEnd(width) + "  最近 " + secs(r.lastMs).padStart(8) + "  " + flag.padEnd(6) +
      "  历史最贵 " + secs(r.maxMs).padStart(9) + "  n=" + String(r.samples) + uv;
  });
  return [
    "门禁实测（宿主 " + last.host + "，" + runScopeLabel(last) + "，" + last.ts + "）",
    ...lines,
    "账本：" + FACTS_PATH + "（生成物，环形保留最近 " + String(FACTS_RUN_CAP) + " 次；文档不得抄上面的值，写「见 pnpm facts」）",
  ].join("\n");
}

/** `pnpm facts --all`：展开环形全量，看漂移本身。 */
export function formatRuns(ledger: FactsLedger | null): string {
  if (!ledger || ledger.runs.length === 0) return "facts: 还没有账本——跑一次 `pnpm gates` 即生成。";
  return ledger.runs
    .map((r) => "  " + r.ts.padEnd(26) + r.host.padEnd(18) + runScopeLabel(r) + "  合计 " + secs(r.gates.reduce((a, g) => a + g.ms, 0)))
    .join("\n");
}

/* ------------------------------------------------ 以下是 CLI，判据与格式化都在上面 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function readLedger(root: string = ROOT): FactsLedger | null {
  const abs = join(root, FACTS_PATH);
  if (!existsSync(abs)) return null;
  try {
    const parsed = JSON.parse(readFileSync(abs, "utf8")) as FactsLedger;
    if (parsed.version !== 1 || !Array.isArray(parsed.runs)) return null;
    return parsed;
  } catch {
    return null; // 账本坏了不影响验收：读不出来就当没有，绝不静默造一个空账
  }
}

/** gates.ts 用完即写；写失败由调用方兜（观测面不得改判据结论）。 */
export function appendRun(run: RunEntry, root: string = ROOT): void {
  const abs = join(root, FACTS_PATH);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(pushRun(readLedger(root), run), null, 2) + "\n");
}

export function currentHost(): string {
  return hostname();
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  const ledger = readLedger();
  console.log(process.argv.includes("--all") ? formatRuns(ledger) : formatFacts(ledger));
}
