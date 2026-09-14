// M5a 靶场 CLI（§m5-proposal 步骤 3/5）：跑 case 输出基线 / 对比基线。
// 用法：
//   node --import tsx scripts/gym-run.ts --all [--model scripted|real] [--out <baseline.json>]
//   node --import tsx scripts/gym-run.ts --case <id> [--fork <eventId>] [--resume-script <path>] [--model scripted|real]
//   node --import tsx scripts/gym-run.ts --all --compare <baseline.json> [--model scripted|real]
// 复跑口径一律 TERM=dumb（vitest 输出 ANSI 会让摘要正则假红）。
// 基线口径（§1.3 备案）：明卷/暗卷分两套，不得混算（§5.9）；暗卷缺 key 显式打印跳过。
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCase, loadGymIndex } from "../src/agent/gym/case";
import {
  cleanupRun,
  forkCase,
  runCase,
  type GymCaseResult,
  type GymModelKind,
} from "../src/agent/gym/runner";

const ROOT = process.cwd();
const GYM = join(ROOT, "fixtures", "gym");

const argv = process.argv.slice(2);
// 审查 S3-12：flag 给了却没带值 = 用法错误，旧实现静默按缺省跑（--out 打错成 --out 尾随
// 时空值 → 少写一份报告还 exit 0；--model 空值 → 悄悄退回 scripted 假装是真模型跑）。fail-visible。
const pick = (flag: string): string | null => {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`[gym-run] ${flag} 需要一个值（收到：${v === undefined ? "缺省" : v}）`);
    process.exit(2);
  }
  return v;
};
const model = (pick("--model") ?? "scripted") as GymModelKind;
const outPath = pick("--out");
const comparePath = pick("--compare");
const caseId = pick("--case");
const forkEventId = pick("--fork");
const resumeScript = pick("--resume-script");
const all = argv.includes("--all");

if (!all && !caseId) {
  console.error("[gym-run] 用法：--all 或 --case <id>；可选 --model/--out/--compare/--fork/--resume-script");
  process.exit(1);
}
if (forkEventId && !caseId) {
  console.error("[gym-run] --fork 需要 --case <id>（父会话 = 该 case 从头跑）");
  process.exit(1);
}

if (model === "real" && !process.env.M0_API_KEY) {
  console.log("[gym-run] 暗卷缺席（无 M0_API_KEY）——显式打印跳过，不计入 pass（未证 ≠ 通过）");
  process.exit(0);
}

const index = await loadGymIndex(GYM);
const entries = caseId ? index.cases.filter((c) => c.id === caseId) : index.cases;
if (entries.length === 0) {
  console.error("[gym-run] 无匹配 case: " + String(caseId));
  process.exit(1);
}

const results: GymCaseResult[] = [];
for (const entry of entries) {
  const c = await loadCase(GYM, entry);
  const parent = await runCase(c, { model });
  try {
    if (forkEventId !== null) {
      // 模式② 分叉重跑：同一段历史，换个策略（--resume-script）会怎样
      const forked = await forkCase(c, parent, forkEventId, { model, resumeScript: resumeScript ?? undefined });
      results.push(forked);
      console.log(`[gym-run] ${c.id} fork@${forkEventId} → score=${String(forked.score)} turns=${String(forked.turns)} in=${String(forked.inputTokens)} out=${String(forked.outputTokens)}`);
    } else {
      results.push(parent);
      console.log(`[gym-run] ${c.id} ${model} → score=${String(parent.score)} turns=${String(parent.turns)} in=${String(parent.inputTokens)} out=${String(parent.outputTokens)} changed=${JSON.stringify(parent.changedFiles)}`);
    }
  } finally {
    if (forkEventId !== null) await cleanupRun(parent);
  }
}

const successRate = results.filter((r) => r.score === 1).length / results.length;
const totalTokens = results.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0);

if (outPath) {
  const baseline = {
    version: 1,
    model,
    generatedAt: new Date().toISOString(),
    successRate,
    totalTokens,
    cases: results.map((r) => ({
      id: r.caseId,
      score: r.score,
      verifyOk: r.verifyOk,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      turns: r.turns,
      changedFiles: r.changedFiles,
    })),
  };
  await writeFile(outPath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
  console.log(`[gym-run] 基线写出 ${outPath}（成功率 ${(successRate * 100).toFixed(1)}%，tokens ${String(totalTokens)}）`);
}

if (comparePath) {
  const base = JSON.parse(await readFile(comparePath, "utf8")) as {
    model: string;
    successRate: number;
    totalTokens: number;
    cases: Array<{ id: string; score: number; inputTokens: number; outputTokens: number }>;
  };
  if (base.model !== model) {
    console.error(`[gym-run] 基线模型不匹配：基线=${base.model} 本次=${model}（明卷/暗卷不得混算，§5.9）`);
    process.exit(1);
  }
  const regress: string[] = [];
  // §6.4：成功率下降 > 2% 或 token 用量上升 > 5% → 视为回退
  if (successRate < base.successRate - 0.02) regress.push(`成功率 ${String(base.successRate)} → ${String(successRate)}（下降超 2%）`);
  if (totalTokens > base.totalTokens * 1.05) regress.push(`tokens ${String(base.totalTokens)} → ${String(totalTokens)}（上升超 5%）`);
  for (const r of results) {
    const b = base.cases.find((x) => x.id === r.caseId);
    if (b && r.inputTokens + r.outputTokens > (b.inputTokens + b.outputTokens) * 1.05) {
      regress.push(`${r.caseId}: tokens ${String(b.inputTokens + b.outputTokens)} → ${String(r.inputTokens + r.outputTokens)}`);
    }
  }
  if (regress.length > 0) {
    console.error("[gym-run] 基线回退：" + regress.join("；"));
    process.exit(1);
  }
  console.log("[gym-run] 基线对比通过（成功率/用量均未回退）");
}

for (const r of results) await cleanupRun(r);
process.exit(0);
